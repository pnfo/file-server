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
 * npm install restify vue vue-server-renderer
 * 
 * dev run as follows (windows)
 * npx nodemon node-server.js library/library-config-dev.json
 * dev writes to a dev json file and does not write to the production json file
 * 
 * prod run as follows (ubuntu)
    pm2 start node-server.js --name library --cron-restart="0 0 * * *" -f -- library-config.json
    pm2 start node-server.js --name cloud -f -- cloud-config.json
 * params after -- are passed to the node script
 * pm2 save (save after changing any process parameters)
 * 
 * git checkin the updated idToinfo json files from the server regularly
 */
import fs from 'fs'
import path from 'path'
import vkb from 'vkbeautify'
import { IndexHandler } from './index-handler.js'
import { password } from './passwords.js'
import { getPossibleMatches } from '@pnfo/singlish-search'

import restify from 'restify';
const server = restify.createServer({maxParamLength: 1000});
//server.pre(restify.pre.sanitizePath()) // removes any trailing slashes from the url
server.use(restify.plugins.bodyParser())

const sendError = (res, err) => { res.send(500, err.stack); res.end(); };
const sendHtml = (res, html) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendRaw(200, html);
};

// load the server config file
const cmdArgs = process.argv.slice(2);
console.log(`reading config file ${cmdArgs[0]}`);
const config = JSON.parse(fs.readFileSync(cmdArgs[0], {encoding: 'utf-8'}));
console.log(`config file ${JSON.stringify(config)}`);

import { setupVueSSR, vueListPage, vueFilePage, vueSearchResult, getTypeInfo } from './vue-handler.js'
const [pageRR, searchRR] = setupVueSSR(config);

const ih = new IndexHandler(config)

const ogImageUrl = config.webUrlRoot + 'static/og-library-500x300.jpg'
const getOgImage = ({type, id}) => (type == 'pdf' && config.displayThumbs) ?
    `https://tipitaka.sgp1.cdn.digitaloceanspaces.com/${config.s3RootFolder}/thumbs/${id}-0.jpg` : ogImageUrl
    
// the variables in the template html file need to be passed in separately
const getContext = (parents, extra) => ({ 
    title: extra + (parents.length ? (parents.slice(-1)[0].name + ' ගොනුව') : config.rootFolderName + ' මුල් පිටුව'), 
    webUrl: config.webUrlRoot, ogImageUrl
});

// reload the files list from s3 and also get the next entry id to be used
server.get(`${config.httpRoot}/refresh/:password`, async function(req, res) {
    try {
        if (req.params.password != password) {
            throw new Error(`supplied password ${req.params.password} is not correct.`)
        }
        const stats = await ih.refreshIndex()
        const statsStr = vkb.json(JSON.stringify(stats))
        sendHtml(res, statsStr);
    } catch(err) {
        sendError(res, err);
    }
});

// return all books page - prefix could be empty if root folder
server.get(`${config.httpRoot}/:folderId/all`, async function(req, res) {
    try {
        const folderId = parseInt(req.params.folderId)
        const entries = ih.getAll(folderId), folder = ih.getFolder(folderId)
        console.log(`all files in entryId ${folderId} has ${entries.length} files`)
        const data = { entries, folder, columns: ['size', 'folder'] }
        const html = await pageRR.renderToString(vueListPage(data), getContext(folder.parents, 'සියලු පොත් < '));
        sendHtml(res, html);
    } catch(err) {
        sendError(res, err);
    }
});

// return newly added books page
server.get(`${config.httpRoot}/:folderId/newly-added/:duration`, async function(req, res) {
    try {
        const backDays = isNaN(req.params.duration) ? 90 : req.params.duration, folderId = parseInt(req.params.folderId)
        const pastDate = new Date(Date.now() - backDays * 24 * 60 * 60 * 1000)
        const entries = ih.getRecentlyAdded(folderId, pastDate), folder = ih.getFolder(folderId)
        console.log(`recent files in ${folderId} from ${backDays}:${pastDate} has ${entries.length} files`);
        const data = { entries, folder, columns: ['size', 'date_added'] };
        const html = await pageRR.renderToString(vueListPage(data), getContext(folder.parents, 'අලුත් පොත් < '));
        sendHtml(res, html);
    } catch(err) {
        sendError(res, err);
    }
});

// return page with list of entries in that folder rendered
server.get(`${config.httpRoot}/:entryId`, async function(req, res) {
    try {
        const entryId = parseInt(req.params.entryId)
        const file = ih.getFile(entryId)
        if (file) {
            console.log(`view file page ${file.id} : ${file.name}`)
            const data = { entry: file }
            const context = { title: file.name, webUrl: config.webUrlRoot, ogImageUrl: getOgImage(file) }
            const html = await pageRR.renderToString(vueFilePage(data), context)
            sendHtml(res, html)
        } else {
            const folder = ih.getFolder(entryId)
            if (!folder) throw new Error(`provided id ${entryId} does not exist`)
            const entries = ih.getChildren(folder.id) // direct children
            console.log(`view folder page ${folder.id || 'root folder'} with ${entries.length} entries`);
            const data = { entries, folder, columns: ['size', 'downloads'] };
            const html = await pageRR.renderToString(vueListPage(data), getContext(folder.parents, ''));
            sendHtml(res, html);
        }
    } catch(err) {
        sendError(res, err);
    }
});

// reading big files from s3 and piping them through to the response was causing this error in the kernal after some time
// "TCP: out of memory -- consider tuning tcp_mem" and 100% cpu load. So generate a signed url and redirect to download directly from s3
// this opens pdfs in the browser directly instead of downloading though. but users can save afterwords
server.get(`${config.httpRoot}/:entryId/download`, async function(req, res) {
    try {
        const entryId = parseInt(req.params.entryId), file = ih.getFile(entryId)
        if (isNaN(req.params.entryId) || !file) {
            throw new Error(`Invalid file id ${entryId} specified or file does not exist`)
        }
        console.log(`download file ${file.id} : ${file.name}.${file.type}`);
        await ih.incrementDownloads(file.id); // increment download count

        const signedUrl = await ih.getSignedUrl(file.Key, 600)
        res.redirect(302, signedUrl, () => {});
    } catch(err) { 
        sendError(res, err); 
    }
});

// search index and return rendered html
server.post(`${config.httpRoot}/api/search/`, async function(req, res) {
    try {
        const body = JSON.parse(req.body)
        const terms = getPossibleMatches(body.query) // get all singlish possibilities 
        const entries = ih.search(body.entryId, [...terms, body.query]) // include the original query in case English name
        console.log(`for query ${body.query}, singlish terms: ${terms.length}/${terms.slice(0, 5)}..., entries found ${entries.length}`);
        const data = { entries, columns: ['size', 'folder'] };
        const html = await searchRR.renderToString(vueSearchResult(data));
        sendHtml(res, html);
    } catch(err) {
        sendError(res, err);
    }
});

// get static files
server.get(`${config.httpRoot}/static/*`, function (req, res, next) {
    const filePath = req.url.substring(req.url.indexOf('/static/'));
    const fullPath = path.join('.', filePath)
    const stream = fs.createReadStream(fullPath);
    stream.on('error', err => sendError(res, err));
    stream.pipe(res, {end: true});
});

async function runServer() {
    try {
        await ih.refreshIndex()
        server.on('close', () => db.close()); //cleanup
        server.listen(config.serverPort);
        console.log(`server listening at ${config.serverPort}`);
    } catch (err) {
        console.error(err);
    }
}
runServer();


// const createFilename = ({name, desc, type}) => name + (desc ? `[${desc}]` : '') + '.' + type
// server.get(`${config.httpRoot}/:entryId/download`, async function(req, res) {
//     try {
//         const entryId = parseInt(req.params.entryId), file = ih.getFile(entryId)
//         if (isNaN(req.params.entryId) || !file) {
//             return sendError(res, `Invalid file id ${entryId} specified or file does not exist`)
//         }
//         console.log(`download file ${file.id} : ${file.name}.${file.type}`);
//         await ih.incrementDownloads(file.id); // increment download count

//         const contentDisposition = file.type.substr(0, 3) == 'htm' ? 'inline' : 'attachment';
//         // chrome does not like comma in filename - so it is removed
//         const filename = encodeURI(createFilename(file).replace(/,/g, ''));
//         res.writeHead(200, {
//             "Content-Type": `${getTypeInfo(file.type)[3]}; charset=utf-8`,
//             "Content-Disposition": `${contentDisposition}; filename*=UTF-8''${filename}`,
//         });
//         const stream = await ih.readStream(file.Key);
//         stream.on('error', err => sendError(res, err));
//         stream.pipe(res, {end: true});
//     } catch(err) { 
//         sendError(res, err); 
//     }
// });

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