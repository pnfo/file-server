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
 * npx nodemon node-server.js library/library-config-dev.json
 * dev writes to a dev db and does not write to the production db
 * 
 * prod run as follows (ubuntu)
 * pm2 start node-server.js --name library -f -- library-config.json
 * params after -- are passed to the node script
 * pm2 save (save after changing any process parameters)
 * 
 * git push from the production server regularly to backup the production db to git
 */
const fs = require('fs'), path = require('path');
const vkb = require('vkbeautify');
const bi = require('./build-index');
const singlish = require('./singlish');
const password = require('./passwords')

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
const [pageRR, searchRR] = vh.setupVueSSR(config);

const dh = require('./db-handler');
const db = new dh.DbHandler(config);

const getContext = (parents, extra) => ({ 
    title: extra + (parents ? (parents.slice(-1)[0].name + ' ගොනුව') : config.rootFolderName + ' මුල් පිටුව'), 
    webUrl: config.webUrlRoot,
});

// return all books page
server.get(`${config.httpRoot}/:entryId/all`, async function(req, res, next) {
    try {
        const entryId = parseInt(req.params.entryId);
        const [entries, parents] = await db.getAll(entryId);
        console.log(`all files has ${entries.length} files`);
        const data = { entries, parents, entryId, columns: ['size', 'folder'] };
        const html = await pageRR.renderToString(vh.vueListPage(data), getContext(parents, 'සියලු පොත් < '));
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
        const html = await pageRR.renderToString(vh.vueListPage(data), getContext(parents, 'අලුත් පොත් < '));
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
        if (entryId == 0 || entry.type == 'coll') { // root folder or sub folder
            console.log(`view folder page ${entryId} : ${entryId ? entry.name : 'root folder'}`);
            const [entries, parents] = await db.getChildren(entryId);
            const data = { entries, parents, entryId, columns: ['size', 'downloads'] };
            const html = await pageRR.renderToString(vh.vueListPage(data), getContext(parents, ''));
            sendHtml(res, html);
        } else {
            console.log(`view file page ${entryId} : ${entry.name}`)
            const data = { entry, parents: db.parentsMap[entry.folder], entryId }
            const context = { title: entry.name, webUrl: config.webUrlRoot }
            const html = await pageRR.renderToString(vh.vueFilePage(data), context)
            sendHtml(res, html)
        }
    } catch(err) {
        sendError(res, err);
    }
});

server.get(`${config.httpRoot}/:entryId/download`, async function(req, res, next) {
    try {
        const entryId = parseInt(req.params.entryId);
        const entry = await db.getEntry(entryId);
        if (entryId == 0 || entry.type == 'coll') { // root folder or sub folder
            sendError(res, 'Can not download folder')
            return
        }
        console.log(`download file ${entryId} : ${entry.name}.${entry.type}`);
        db.incrementDownloads(entryId); // increment download count

        const contentDisposition = entry.type.substr(0, 3) == 'htm' ? 'inline' : 'attachment';
        const fileName = encodeURI(   // chrome does not like comma in filename - so it is removed
            dh.createFileName({name: entry.name, desc: entry.desc, rowid: '', type: entry.type}).replace(/,/g, ''));
        res.writeHead(200, {
            "Content-Type": `${vh.getTypeInfo(entry.type)[3]}; charset=utf-8`,
            "Content-Disposition": `${contentDisposition}; filename*=UTF-8''${fileName}`,
        });
        //const filePath = path.join(config.filesRootFolder, db.getUrl(entry));
        const stream = fs.createReadStream(db.getUrl(entry));
        stream.on('error', err => sendError(res, err));
        stream.pipe(res, {end: true});
    } catch(err) { 
        sendError(res, err); 
    }
});

// search index and return rendered html
server.post(`${config.httpRoot}/api/search/`, async function(req, res, next) {
    try {
        const body = JSON.parse(req.body);
        // Search all singlish_combinations of translations from roman to sinhala
        const queryTerms = singlish.getTerms(body.query);
        const entries = await db.search(body.entryId, queryTerms);
        console.log(`for query ${body.query} num. of terms ${queryTerms.length}, files found ${entries.length}`);
        const data = { entries, columns: ['size', 'folder'] };
        const html = await searchRR.renderToString(vh.vueSearchResult(data));
        sendHtml(res, html);
    } catch(err) {
        sendError(res, err);
    }
});

// rebuild index on some folder - 0 for root folder
server.get(`${config.httpRoot}/api/rebuild-index/:folderId/:password`, function(req, res, next) {
    const folderId = parseInt(req.params.folderId);
    if (isNaN(folderId) || (folderId && !db.rowid2Row[folderId])) {
        sendError(res, `supplied folderid is not correct.`);
        return;
    }
    if (req.params.password != password.word) {
        sendError(res, `supplied password ${req.params.password} is not correct.`);
        return;
    }
    const folderFilesRoot = path.join(config.filesRootFolder, folderId ? db.folderPaths[folderId] : '');
    bi.rebuildIndex(db, folderFilesRoot, folderId, false).then(dbStats => {
        const dbStatsStr = vkb.json(JSON.stringify(dbStats))
        console.log(`rebuild index on ${folderFilesRoot} final stats ${dbStatsStr}`);
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