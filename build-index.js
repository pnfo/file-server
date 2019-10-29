// read the original download counts from the mediafire
// read the directory structure and the files
// create entries in the sqlite db - if not already existing
// restart the node server - so the updated db files is used
"use strict";

const fs = require('fs');
const vkb = require('vkbeautify');
const path = require('path');
const assert = require('assert');
const dh = require('./db-handler');

const rootFolder = 'D:/ebooks';

const getMapKey = (name, desc, type) => `${name}@${desc}@${type}`;
const getDate = (date) => date.toISOString().split('T')[0];
let rewriteNameFiles = {}; // reloaded inside the buildIndex()
let db;

function parseFileName(fileName) {
    var result = /^([^\[]+)(?:\[(.+)\])?\.(.+)$/g.exec(fileName);
    if (!result) console.error(`Filename ${fileName} can not be parsed`);
    return [result[1].trim(), result[2] || '', result[3]];
}

let mfBooksList = {}, copyMediafireStats = false;
function extractMediafireStats() {
    mfBooksList = {};
    JSON.parse(fs.readFileSync('./data/mediafire-books-list.json', {encoding: 'utf-8'})).forEach(mfBook => {
        mfBook.files.forEach(mfFile => {
            if (mfFile.type == "collection") return;  // discard collections/folders
            const mapKey = getMapKey(mfBook.name, mfFile.desc || '', mfFile.type);
            assert(!mfBooksList[mapKey], `${mapKey} already exists in the mfBookList`);
            mfBooksList[mapKey] = {
                'date_added': mfFile.time,
                'downloads': mfFile.downloads,
                'old_url': mfFile.url,
            };
        });
    });
    console.log(`mediafire files list size: ${Object.keys(mfBooksList).length}`);
}

function getIgnoreFiles(fullPath) {
    const ignoreFileName = path.join(fullPath, 'ignore-files.txt');
    if (!fs.existsSync(ignoreFileName)) return [];
    const iList = fs.readFileSync(ignoreFileName, {encoding: 'utf-8'}).split('\r\n');
    iList.push('ignore-files.txt');
    return iList;
}

async function processFolder(fullPath, parentFolders) {
    const filesList = fs.readdirSync(fullPath);
    const ignoreFileList = getIgnoreFiles(fullPath);
    for (const fileName of filesList) {
        if (ignoreFileList.indexOf(fileName) >= 0) continue;
        const newPath = path.join(fullPath, fileName);
        const lstat = fs.lstatSync(newPath);
        if (lstat.isDirectory()) {
            await processFolder(newPath, [...parentFolders, fileName]); // recursively process sub folders
        } else {
            await processFile(fileName, lstat, parentFolders);
        }
    }
}

// go through all files 
let dbStats = {};
async function processFile(fileName, lstat, parentFolders) {
    dbStats.filesProcessed++;
    let [name, desc, type] = parseFileName(fileName); // primary key

    // rewrite names for some files - specially used for html files
    if (rewriteNameFiles[fileName]) name = rewriteNameFiles[fileName];

    // check if this row exists - if not add new, else update
    const curRow = await db.getAsync('SELECT * FROM entry WHERE name = ? AND desc = ? AND type = ?', [name, desc, type]);

    const url = parentFolders.join('/') + '/' + fileName;
    const size = lstat.size; // in bytes
    const date_added = getDate(lstat.birthtime);
    const folders = JSON.stringify(parentFolders);

    if (curRow) {
        // update existing row
        if (curRow.url != url || curRow.folders != folders || curRow.size != size) { 
            // update url, folders. if size changed, update the date too
            const setSize = (curRow.size != size) ? ', size = ?, date_added = ?' : '';
            const params = (curRow.size != size) ? [url, folders, size, date_added] : [url, folders];
            await db.runAsync(`UPDATE entry SET url = ?, folders = ? ${setSize} WHERE name = ? AND desc = ? AND type = ?`, [...params, name, desc, type]);
            dbStats.rowsUpdated++;
        }
        return;
    }

    // new row needs to be added
    const downloads = 0;
    let newRow = [ name, desc, type, url, size ]; 

    // 1) if in mediafire - copy the stats 2) else create a new entry in db
    const mapKey = getMapKey(name, desc, type);
    if (!mfBooksList[mapKey]) {
        if (copyMediafireStats) console.log(`new file not in mediafire found ${mapKey}`);
        newRow = [...newRow, date_added, downloads, folders, '{}'];
        dbStats.rowsNotFoundInMF++;
    } else {
        // copy over the date, downloads and old_url
        const mfBook = mfBooksList[mapKey];
        newRow = [...newRow, getDate(new Date(mfBook.date_added)), mfBook.downloads, folders, JSON.stringify({old_url: mfBook.old_url})];
        delete mfBooksList[mapKey]; // delete used so unused can be tracked
        dbStats.rowsFoundInMF++;
    }

    await db.runAsync('INSERT INTO entry(name, desc, type, url, size, date_added, downloads, folders, extra_prop) VALUES (?,?,?,?,?,?,?,?,?)', newRow);
    dbStats.rowsAdded++;
}

// REPLACE = (insert or update) entries for the html links
async function addHtmlLinks() {
    const newLinksToAdd = JSON.parse(fs.readFileSync('./data/add-new-links.json', {encoding: 'utf-8'}));
    for (const linkInfo of newLinksToAdd) {
        const params = [linkInfo[0], '', 'link', linkInfo[1], 0, JSON.stringify([linkInfo[2]])];
        // keep existing downloads count and date_added (default 0 and now respectively)
        await db.runAsync('REPLACE INTO entry (name, desc, type, url, size, folders) VALUES (?,?,?,?,?,?)', params);
        dbStats.linksReplaced++;
    }
}

async function brokenUrlChecker() {
    const rows = await db.allAsync('SELECT name, desc, type, url FROM entry');
    rows.forEach(row => {
        if (row.type != 'link' && !fs.existsSync(path.join(rootFolder, row.url))) {
            console.error(`broken url detected ${row.name},${row.desc},${row.type}: ${row.url}`);
        }
    });
}

async function rebuildIndex() {
    db = new dh.DbHandler();
    if (copyMediafireStats) extractMediafireStats();
    rewriteNameFiles = JSON.parse(fs.readFileSync('./data/rewrite-names.json', {encoding: 'utf-8'}));
    dbStats = {filesProcessed: 0, rowsAdded: 0, rowsUpdated: 0, rowsFoundInMF: 0, rowsNotFoundInMF: 0, linksReplaced: 0};
    await processFolder(rootFolder, []);
    await addHtmlLinks();
    await brokenUrlChecker();
    db.close();
    return dbStats;
}

module.exports = { rebuildIndex, getDate };
/*
rebuildIndex().then((dbStats) => {  
    console.log(`final stats ${JSON.stringify(dbStats)}`);
    if (copyMediafireStats) {
        for (const mapKey in mfBooksList) {
            console.log(`unused mf entry ${mapKey} : ${JSON.stringify(mfBooksList[mapKey])}`);
        }
    }
});*/
/** obselete code

const book_to_html = JSON.parse(fs.readFileSync('./data/book-to-html.json', {encoding: 'utf-8'}));
const rewriteNameFiles = {}, newLinksToAdd = [];
Object.keys(book_to_html).forEach(bookName => {
    const url = book_to_html[bookName].url;
    const fileName = url.split('/').slice(-1)[0];
    if (fileName.endsWith('.htm')) {
        rewriteNameFiles[fileName] = bookName;
    } else if (url.endsWith('/')) {
        newLinksToAdd.push([bookName, url]);
    } else {
        console.log(`unknown type of url found ${url}`);
    }
});
fs.writeFileSync('./data/rewrite-names.json', vkb.json(JSON.stringify(rewriteNameFiles)), {encoding: 'utf-8'});
fs.writeFileSync('./data/add-new-links.json', vkb.json(JSON.stringify(newLinksToAdd)), {encoding: 'utf-8'});
 */