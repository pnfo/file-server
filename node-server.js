/**
 * serve the template with the search function
 * 
 * need routes for
 * 1) increment downloads
 * 2) rebuild index with new files 
 * 3) search by name
 * 4) search by folder
 * 
 * 3rd party dependencies
 * npm install restify vue vue-server-renderer sqlite3
 * 
 * dev run as follows (windows)
 * npx nodemon .\node-server.js library-config.json
 * 
 * prod run as follows (ubuntu)
 * pm2 start node-server.js -- library-config.json
 */
const fs = require('fs'), path = require('path');
const bi = require('./build-index');
const singlish = require('./singlish');

const restify = require('restify');
const server = restify.createServer({maxParamLength: 1000});
server.use(restify.plugins.bodyParser());

const sendError = (res, err) => { res.send(500, err.toString()); res.end(); };
const sendHtml = (res, html) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendRaw(200, html);
};

// load the server config file
const cmdArgs = process.argv.slice(2);
console.log(`reading config file ${cmdArgs[0]}`);
const config = JSON.parse(fs.readFileSync(cmdArgs[0], {encoding: 'utf-8'}));
console.log(`config file ${JSON.stringify(config)}`);

const vh = require('./vue-handler');
const [pageRR, searchRR] = vh.setupVueSSR(config.indexHtmlTemplate);

const dh = require('./db-handler');
const db = new dh.DbHandler(config.databaseFilePath);

// return all books page
server.get(`${config.httpRoot}/all/`, function(req, res, next) {
    db.getAll().then(books => {
        console.log(`all files has ${books.length} books`);
        const data = { title: 'සියලු පොත්', books, folders: [], parents: [] };
        pageRR.renderToString(vh.vueFullPage(data), data, (err, html) => {
            err ? sendError(res, err) : sendHtml(res, html);
        });
    }).catch(err => {
        sendError(res, err);
    });
});

// return newly added books page
server.get(`${config.httpRoot}/newly-added/:duration`, function(req, res, next) {
    const backDays = isNaN(req.params.duration) ? 90 : req.params.duration;
    const pastDate = bi.getDate(new Date(new Date().setDate(new Date().getDate() - backDays)));
    db.getRecentlyAdded(pastDate).then(books => {
        console.log(`recent files ${backDays}:${pastDate} has ${books.length} books`);
        const data = { title: 'අලුත් පොත්', books, folders: [], parents: [] };
        pageRR.renderToString(vh.vueFullPage(data), data, (err, html) => {
            err ? sendError(res, err) : sendHtml(res, html);
        });
    }).catch(err => {
        sendError(res, err);
    });
});

// return page with list of entries in that folder rendered
server.get(`${config.httpRoot}/folder/:folders`, function(req, res, next) {
    let parents = req.params.folders ? req.params.folders.split(',') : [];
    parents = parents.map(folder => folder.split('-').join(' ')); // we replace spaces with -
    db.getFolder(parents).then(([books, folders]) => {
        console.log(`view folder page ${parents}, books found ${books.length}, folders found ${folders.length}`);
        const data = { title: [config.htmlTitle, ...parents].reverse().join(' < '), books, folders, parents };
        pageRR.renderToString(vh.vueFullPage(data), data, (err, html) => {
            err ? sendError(res, err) : sendHtml(res, html);
        });
    }).catch(err => {
        sendError(res, err);
    });
});

server.get(`${config.httpRoot}/download/:entryId`, function (req, res, next) {
    const entryId = req.params.entryId;
    db.getEntryFromId(entryId).then(row => {
        if (!row.name) {
            sendError(res, `entry ${entryId} does not exist`);
            return;
        }
        const filePath = path.join(config.filesRootFolder, row.url);
        if (row.type != 'link' && !fs.existsSync(filePath)) {
            console.error(`file for entry id ${entryId} does not exist ${filePath}`);
            sendError(res, `file ${filePath} does not exist`);
            return;
        }
        console.log(`download book id ${entryId}, book name ${row.name}`);
        db.incrementDownloads(entryId); // increment download count
        if (row.type == 'link') {
            res.redirect(row.url, next);
            return;
        }

        const contentDisposition = row.type.substr(0, 3) == 'htm' ? 'inline' : 'attachment';
        const fileName = encodeURI(row.url.split('/').pop());
        res.writeHead(200, {
            "Content-Type": `${vh.getTypeInfo(row.type)[3]}; charset=utf-8`,
            "Content-Disposition": `${contentDisposition}; filename*=UTF-8''${fileName}`,
        });
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => sendError(res, err));
        stream.pipe(res, {end: true});
    }).catch(err => {
        sendError(res, err);
    });
});

// search index and return rendered html
server.post(`${config.httpRoot}/api/search/`, function(req, res, next) {
    //const query = JSON.parse(req.body);
    // Search all singlish_combinations of translations from roman to sinhala
    const queryTerms = singlish.getTerms(req.body);
    db.search(queryTerms).then(books => {
        console.log(`number of search query terms ${queryTerms.length}, books found ${books.length}`);
        searchRR.renderToString(vh.vueBookList(books), (err, html) => {
            err ? sendError(res, err) : sendHtml(res, html);
        });
    }).catch(err => {
        sendError(res, err);
    });
});

// rebuild index
server.get(`${config.httpRoot}/api/rebuild-index`, function(req, res, next) {
    bi.rebuildIndex(db, config.filesRootFolder, config.rebuildDataFolder).then(dbStats => {
        console.log(`rebuild index final stats ${JSON.stringify(dbStats)}`);
        res.send(200, dbStats);
    }).catch(err => {
        sendError(res, err);
    });
});

// get static files
server.get(`${config.httpRoot}/static/*`, function (req, res, next) {
    const filePath = req.url.substr(req.url.indexOf('/static/'));
    const fullPath = path.join(__dirname, filePath);
    const stream = fs.createReadStream(fullPath);
    stream.on('error', err => sendError(res, err));
    stream.pipe(res, {end: true});
});

try {
    server.listen(config.serverPort);
    console.log(`server listening at ${config.serverPort}`);
} catch (err) {
    console.error(err);
}
server.on('close', () => {
    //cleanup
    db.close();
});

/*
// return page with one entry and thumbnails/info etc
server.get('/entry/:entryId', function(req, res, next) {
    const entryId = req.params.entryId;
    res.send(200, entryId);
    next();
});
// increment download count
server.get('/api/increment/:entryId', function(req, res, next) {
    const entryId = req.params.entryId;
    db.incrementDownloads(entryId).then(newCount => {
        console.log(`increment downloads for ${entryId}, rows affected ${newCount}.`);
        res.send(200, {newCount});
        next();
    }).catch(err => {
        sendError(res, err, next);
    });
});
*/