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

const getContext = (parents, extra) => { return { title: extra + (parents.slice(-1).name || config.htmlTitle) }; };

// return all books page
server.get(`${config.httpRoot}/:entryId/all`, async function(req, res, next) {
    try {
        const entryId = parseInt(req.params.entryId);
        const [entries, parents] = await db.getAll(entryId);
        console.log(`all files has ${entries.length} files`);
        const data = { entries, parents, entryId, columns: ['size', 'folder'] };
        const html = await pageRR.renderToString(vh.vueFullPage(data), getContext(parents, 'සියලු පොත් < '));
        sendHtml(res, html);
    } catch(err) {
        sendError(res, err);
    }
});

// return newly added books page
server.get(`${config.httpRoot}/:entryId/newly-added/:duration`, async function(req, res, next) {
    try {
        const backDays = isNaN(req.params.duration) ? 90 : req.params.duration;
        const pastDate = bi.getDate(new Date(new Date().setDate(new Date().getDate() - backDays)));
        const entryId = parseInt(req.params.entryId);
        const [entries, parents] = await db.getRecentlyAdded(entryId, pastDate);
        console.log(`recent files in ${entryId} from ${backDays}:${pastDate} has ${entries.length} files`);
        const data = { entries, parents, entryId, columns: ['size', 'date_added'] };
        const html = await pageRR.renderToString(vh.vueFullPage(data), getContext(parents, 'අලුත් පොත් < '));
        sendHtml(res, html);
    } catch(err) {
        sendError(res, err);
    }
});

// return page with list of entries in that folder rendered
server.get(`${config.httpRoot}/:entryId`, async function(req, res, next) {
    try {
        const entryId = parseInt(req.params.entryId);
        const entry = await db.getEntry(entryId);
        console.log(`view entry page ${entryId} : ${entry.name}.${entry.type}`);
        if (entry.type == 'coll') {
            const [entries, parents] = await db.getChildren(entryId);
            const data = { entries, parents, entryId, columns: ['size', 'downloads'] };
            const html = await pageRR.renderToString(vh.vueFullPage(data), getContext(parents, ''));
            sendHtml(res, html);
        } else {
            db.incrementDownloads(entryId); // increment download count

            const contentDisposition = row.type.substr(0, 3) == 'htm' ? 'inline' : 'attachment';
            const fileName = encodeURI(row.url.split('/').pop());
            res.writeHead(200, {
                "Content-Type": `${vh.getTypeInfo(row.type)[3]}; charset=utf-8`,
                "Content-Disposition": `${contentDisposition}; filename*=UTF-8''${fileName}`,
            });
            const filePath = path.join(config.filesRootFolder, db.getUrl(entry));
            const stream = fs.createReadStream(filePath);
            stream.on('error', err => sendError(res, err));
            stream.pipe(res, {end: true});
        }
    } catch(err) {
        sendError(res, err);
    }
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
server.post(`${config.httpRoot}/api/search/`, async function(req, res, next) {
    try {
        const body = JSON.parse(req.body);
        // Search all singlish_combinations of translations from roman to sinhala
        const queryTerms = singlish.getTerms(body.query);
        const entries = await db.search(body.entryId, queryTerms);
        console.log(`for query ${body.query} num. of terms ${queryTerms.length}, files found ${entries.length}`);
        const html = await searchRR.renderToString(vh.vueBookList(books));
        sendHtml(res, html);
    } catch(err) {
        sendError(res, err);
    }
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

async function runServer() {
    try {
        await db.initFolderStructure();        
        server.on('close', () => db.close()); //cleanup
        server.listen(config.serverPort);
        console.log(`server listening at ${config.serverPort}`);
    } catch (err) {
        console.error(err);
    }
}
runServer();

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