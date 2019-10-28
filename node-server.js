/**
 * serve the template with the search function
 * 
 * need routes for
 * 1) increment downloads
 * 2) rebuild index with new files 
 * 3) search by name
 * 4) search by folder
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

const filesRootFolder = 'D:/ebooks', //'/datadrive/files/public/library', 
    serverPort = 8080;

server.get('/all/', function(req, res, next) {
    // return all books page
    res.send(200, `test all ${req}`);
    next();
});

server.get('/newly-added/:lookbackDuration', function(req, res, next) {
    // return newly added books page
});

// return page with list of entries in that folder rendered
server.get('/folder/:folders', function(req, res, next) {
    let parentFolders = req.params.folders ? req.params.folders.split('/') : [];
    parentFolders = parentFolders.map(folder => folder.split('-').join(' ')); // we replace spaces with -
    db.getFolder(parentFolders).then(([books, folders]) => {
        console.log(`view folder page ${parentFolders}, books found ${books.length}, folders found ${folders.length}`);
        const context = { title: parentFolders.reverse().join('<') };
        vh.pageRenderer(books, folders, parentFolders, context, (err, html) => {
            if (err) {
                res.send(500, err.toString()); //Internal Server Error
                return;
            }
            res.setHeader('Content-Type', 'text/html');
            res.sendRaw(200, html);
            next();
        });
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
            if (err) {
                res.send(500, err.toString()); //Internal Server Error
                return;
            }
            res.setHeader('Content-Type', 'text/html');
            res.sendRaw(200, html);
            next();
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
