/**
 * Read the directory structure and the files and create/update entries in the sqlite db
 * Filename has {rowid} which maps to the rowid in the db
 * GUIDE
 * File name format - name[desc]{rowid}.type
 * Only specify {rowid} if you need to replace/update an exisiting file/folder with a new file/folder
 * For new files keep the {rowid} empty.
 * 
 * update: 2020 april - rebuild index is now not recursive, mediafire code commented out
 */
"use strict";

const fs = require('fs');
const vkb = require('vkbeautify');
const path = require('path');
const assert = require('assert');
const dh = require('./db-handler');

//const getMFMapKey = (name, desc, type) => `${name}@${desc}@${type}`;
const getDate = (date) => date.toISOString().split('T')[0];
let db;

/*let mfBooksList = {}, copyMediafireStats = false;
function extractMediafireStats(mediafireDataFile) {
    mfBooksList = {};
    JSON.parse(fs.readFileSync(mediafireDataFile, {encoding: 'utf-8'})).forEach(mfBook => {
        mfBook.files.forEach(mfFile => {
            if (mfFile.type == "collection") return;  // discard collections/folders
            const mapKey = getMFMapKey(mfBook.name, mfFile.desc || '', mfFile.type);
            //assert(!mfBooksList[mapKey], `${mapKey} already exists in the mfBookList`);
            mfBooksList[mapKey] = {
                'date_added': mfFile.time,
                'downloads': mfFile.downloads,
                'old_url': mfFile.url,
            };
        });
    });
    console.log(`mediafire files list size: ${Object.keys(mfBooksList).length}`);
}*/

function getIgnoreFiles(fullPath) {
    const ignoreFileName = path.join(fullPath, 'ignore-files.txt');
    if (!fs.existsSync(ignoreFileName)) return [];
    const iList = fs.readFileSync(ignoreFileName, {encoding: 'utf-8'}).split('\r\n');
    iList.push('ignore-files.txt');
    return iList;
}

// go through all files 
let dbStats = {};
async function processFilesInFolder(fullPath, parentFolder, isRecursive) {
    const filesList = fs.readdirSync(fullPath);
    const ignoreFileList = getIgnoreFiles(fullPath);
    for (const fileName of filesList) {
        if (ignoreFileList.indexOf(fileName) >= 0) continue;
        const filePath = path.join(fullPath, fileName);
        const lstat = fs.lstatSync(filePath);

        let addedRowid, newFileName;
        if (lstat.isDirectory()) {
            [addedRowid, newFileName] = await processFolder(fileName, lstat, parentFolder);
            if (isRecursive) await processFilesInFolder(filePath, addedRowid, isRecursive); // recursively process sub folders
        } else {
            [addedRowid, newFileName] = await processFile(fileName, lstat, parentFolder);
        }
        
        // rename the processed file/folder
        if (newFileName != fileName) {
            console.log(`renaming ${fileName} -> ${newFileName}`);
            fs.renameSync(path.join(fullPath, fileName), path.join(fullPath, newFileName));
        }
        dbStats.entriesProcessed++;
    }
}

async function processFolder(fileName, lstat, parentFolder) {
    let [name, desc, rowid, type] = dh.parseFileName(fileName);
    
    if (rowid) { // update row
        const curRow = await db.getAsync('SELECT * FROM entry WHERE rowid = ?', [rowid]);
        if (curRow) { 
            // one the four fields name,desc,folders,date_added may or may not have changed.
            // set is_deleted to false too - in case a deleted folder was brought back again
            const params = [name, desc, "coll", parentFolder, 0, rowid]
            await db.runAsync('UPDATE entry SET name = ?, desc = ?, type = ?, folder = ?, is_deleted = ? WHERE rowid = ?', params);
            dbStats.foldersUpdated++;
            return [rowid, dh.createFileName({name, desc, rowid, type})]
        } // if the rowid does not exist we need to add it
    }

    // need to create a new row
    const newRow = [name, desc, "coll", parentFolder, getDate(lstat.birthtime)];
    rowid = await db.runAsync('INSERT INTO entry(name, desc, type, folder, date_added) VALUES (?,?,?,?,?)', newRow);
    dbStats.foldersAdded++;
    
    return [rowid, dh.createFileName({name, desc, rowid, type})];
}


async function processFile(fileName, lstat, folder) {
    let [name, desc, rowid, type] = dh.parseFileName(fileName);
    const size = lstat.size; // in bytes

    if (rowid) { // update existing row
        const curRow = await db.getAsync('SELECT * FROM entry WHERE rowid = ?', [rowid]);
        if (curRow) { 
            // update all except the downloads and date_added - in many cases the update is unnecessary as the fields are not changed
            // but will have to check each field to see if an update is needed - so update all anyway
            const params = [ name, desc, type, folder, size, 0, rowid ];
            await db.runAsync(`UPDATE entry SET name = ?, desc = ?, type = ?, folder = ?, size = ?, is_deleted = ? WHERE rowid = ?`, params);
            dbStats.filesUpdated++;
            return [rowid, dh.createFileName({name, desc, rowid, type})];
        } // if the rowid does not exist we need add a new row
    } 

    // new row needs to be added
    let newRow = [ name, desc, type, folder, size]; 

    // 1) if in mediafire copy over the date, downloads and old_url
    //const mapKey = getMFMapKey(name, desc, type);
    //if (mfBooksList[mapKey]) {
    //    const mfBook = mfBooksList[mapKey];
    //    newRow = [...newRow, getDate(new Date(mfBook.date_added)), mfBook.downloads, JSON.stringify({old_url: mfBook.old_url})];
    //    delete mfBooksList[mapKey]; // delete used so unused can be tracked
    //    dbStats.rowsFoundInMF++;
    //} else {
    //    if (copyMediafireStats) console.log(`new file not in mediafire found ${mapKey}`);
        newRow = [...newRow, getDate(lstat.birthtime), 0, '{}'];
    //    dbStats.rowsNotFoundInMF++;
    //}

    rowid = await db.runAsync('INSERT INTO entry(name, desc, type, folder, size, date_added, downloads, extra_prop) VALUES (?,?,?,?,?,?,?,?)', newRow);
    dbStats.filesAdded++;

    return [rowid, dh.createFileName({name, desc, rowid, type})];
}

async function brokenUrlChecker(parentFolder) {
    //const rows = await db.allAsync('SELECT rowid, name, desc, type, folder FROM entry WHERE is_deleted = ?', [0]);
    const [rows, _1] = await db.getAll(parentFolder);
    for (let row of rows) {
        const url = db.getUrl(row);
        if (row.type != 'link' && !fs.existsSync(url)) {
            console.error(`file ${url} does not exist. marking ${row.rowid} as deleted`);
            await db.runAsync(`UPDATE entry SET is_deleted = ? WHERE rowid = ?`, [1, row.rowid]);
            dbStats.markedAsDeleted++;
        }
    }
    /*if (copyMediafireStats) {
        for (const mapKey in mfBooksList) {
            console.log(`unused mf entry ${mapKey} : ${JSON.stringify(mfBooksList[mapKey])}`);
        }
    }*/
}

async function rebuildIndex(dbHandler, folderFilesRoot, parentFolder, isRecursive) {
    db = dbHandler;
    //if (copyMediafireStats) extractMediafireStats(mediafireDataFile);
    dbStats = {entriesProcessed: 0, filesAdded: 0, filesUpdated: 0, foldersAdded: 0, foldersUpdated: 0, markedAsDeleted: 0, linksReplaced: 0};
    await processFilesInFolder(folderFilesRoot, parentFolder, isRecursive);
    await db.initFolderStructure(); // since the folders may have changed
    await brokenUrlChecker(parentFolder);
    return dbStats;
}

module.exports = { rebuildIndex, getDate };


// run inline for testing
async function runRebuildIndex() {
    const config = {data: './cloud/cloud-dev.db'};
    db = new dh.DbHandler(config);
    await db.init();
    await rebuildIndex(db, 'D:/ebooks', 0, './cloud/somefile')
    console.log(`final stats ${JSON.stringify(dbStats)}`);
    db.close();
}
//runRebuildIndex();

/*
// REPLACE = (insert or update) entries for the html links
async function addHtmlLinks(dataFolder) {
    const newLinksToAdd = JSON.parse(fs.readFileSync(`${dataFolder}/add-new-links.json`, {encoding: 'utf-8'}));
    for (const linkInfo of newLinksToAdd) {
        const params = [linkInfo[0], '', 'link', linkInfo[1], 0, JSON.stringify([linkInfo[2]])];
        // keep existing downloads count and date_added (default 0 and now respectively)
        await db.runAsync('REPLACE INTO entry (name, desc, type, url, size, folders) VALUES (?,?,?,?,?,?)', params);
        dbStats.linksReplaced++;
    }
}
*/