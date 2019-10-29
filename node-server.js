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
 */
const dh = require('./db-handler');
const fs = require('fs'), path = require('path');
const db = new dh.DbHandler();
const bi = require('./build-index');

const restify = require('restify');
const server = restify.createServer({maxParamLength: 1000});
server.use(restify.plugins.bodyParser());

const vh = require('./vue-handler');

const renderer = require('vue-server-renderer').createRenderer()
const sendError = (res, err, next) => { res.send(500, err.toString()); next(); };
const sendHtml = (res, html, next) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendRaw(200, html);
    next();
};

const filesRootFolder = 'D:/ebooks', //'/datadrive/files/public/library', 
    serverPort = 8080;

// return all books page
server.get('/all/', function(req, res, next) {
    db.getAll().then(books => {
        const data = { title: 'සියලු පොත්', books, folders: [], parents: [] };
        vh.pageRenderer(data, (err, html) => {
            err ? sendError(res, err, next) : sendHtml(res, html, next);
        });
    }).catch(err => {
        sendError(res, err, next);
    });
});

// return newly added books page
server.get('/newly-added/:duration', function(req, res, next) {
    const backDays = isNaN(req.params.duration) ? 90 : req.params.duration;
    const pastDate = bi.getDate(new Date(new Date().setDate(new Date().getDate() - backDays)));
    db.getRecentlyAdded(pastDate).then(books => {
        console.log(`recent books ${backDays}:${pastDate} has ${books.length} books`);
        const data = { title: 'අලුත් පොත්', books, folders: [], parents: [] };
        vh.pageRenderer(data, (err, html) => {
            err ? sendError(res, err, next) : sendHtml(res, html, next);
        });
    }).catch(err => {
        sendError(res, err, next);
    });
});

// return page with list of entries in that folder rendered
server.get('/folder/:folders', function(req, res, next) {
    console.log(req.params);
    let parents = req.params.folders ? req.params.folders.split(',') : [];
    parents = parents.map(folder => folder.split('-').join(' ')); // we replace spaces with -
    db.getFolder(parents).then(([books, folders]) => {
        console.log(`view folder page ${parents}, books found ${books.length}, folders found ${folders.length}`);
        const data = { title: ['පුස්තකාලය', ...parents].reverse().join(' < '), books, folders, parents };
        vh.pageRenderer(data, (err, html) => {
            err ? sendError(res, err, next) : sendHtml(res, html, next);
        });
    }).catch(err => {
        sendError(res, err, next);
    });
});

server.get('/download/:entryId', function (req, res, next) {
    const entryId = req.params.entryId;
    db.getEntryFromId(entryId).then(row => {
        if (!row.name) {
            sendError(res, `entry ${entryId} does not exist`, next);
            return;
        }
        const filePath = path.join(filesRootFolder, row.url);
        if (row.type != 'link' && !fs.existsSync(filePath)) {
            console.error(`file for entry id ${entryId} does not exist ${filePath}`);
            sendError(res, `file ${filePath} does not exist`, next);
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
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res, {end: true});
        readStream.on('end', () => { next(); } );
    }).catch(err => {
        sendError(res, err, next);
    });
});

// search index and return rendered html
server.post('/api/search/', function(req, res, next) {
    const queryTerms = JSON.parse(req.body); //req.params.queryTerms.split(',');
    db.search(queryTerms).then(books => {
        console.log(`number of search query terms ${queryTerms.length}, books found ${books.length}`);
        renderer.renderToString(vh.bookListRenderer(books), (err, html) => {
            err ? sendError(res, err, next) : sendHtml(res, html, next);
        });
    }).catch(err => {
        sendError(res, err, next);
    });
});

// rebuild index
server.get('/api/rebuild-index', function(req, res, next) {
    bi.rebuildIndex(db).then(dbStats => {
        console.log(`rebuild index final stats ${JSON.stringify(dbStats)}`);
        res.send(200, dbStats);
        next();
    }).catch(err => {
        sendError(res, err, next);
    });
});

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

// place all the static files in the static dir (icons, fonts, client side scripts etc)
server.get('/static/*', restify.plugins.serveStatic({
    directory: __dirname
}));

try {
    server.listen(serverPort);
    console.log(`server listening at ${serverPort}`);
} catch (err) {
    console.error(err);
}
server.on('close', () => {
    //cleanup
    db.close();
});
