/**
 * Db table format as follows
 * CREATE TABLE `entry2` (
	`name`	TEXT NOT NULL,
	`desc`	TEXT NOT NULL,
	`type`	TEXT NOT NULL,
	`folder`	INTEGER NOT NULL DEFAULT 0,
	`size`	INTEGER NOT NULL DEFAULT 0,
	`date_added`	TEXT NOT NULL DEFAULT CURRENT_DATE,
	`downloads`	INTEGER NOT NULL DEFAULT 0,
	`is_deleted`	INTEGER NOT NULL DEFAULT 0,
	`extra_prop`	TEXT NOT NULL DEFAULT '{}',
	UNIQUE(`name`,`desc`,`type`, `folder`)
);
 */

const sqlite3 = require('sqlite3');
const path = require('path');

function parseFileName(fileName) {
    // name[desc]{rowid}.type - [desc] is optional, {rowid} will be filled by the buildIndex
    const res = /^(.+?)(?:\[(.*)\])?(?:\{(\d+)\})?(?:\.(\w+))?$/.exec(fileName);
    if (!res) console.error(`File name ${fileName} can not be parsed`);
    return [res[1].trim(), res[2] || '', res[3] || 0, res[4] || 'coll'];
}
/*function parseFolderName(fileName) { // same as above without type
    const res = /^(.+?)(?:\[(.*)\])?(?:\{(\d+)\})?$/.exec(fileName);
    if (!res) console.error(`Folder name ${fileName} can not be parsed`);
    return [res[1].trim(), res[2] || '', res[3] || 0, 'coll'];
}*/
function createFileName(name, desc, rowid, type) {
    desc = desc ? `[${desc}]` : '';
    rowid = rowid ? `{${rowid}}` : '';
    type = type != 'coll' ? `.${type}` : '';
    return `${name}${desc}${rowid}${type}`;
}

function groupRowsByName(rows) {
    const rowGs = {};
    rows.forEach(row => {
        let rowG = rowGs[row.name];
        if (!rowG) {
            rowG = { name: row.name, downloads: row.downloads, folders: row.folders, entries: [row] };
            // TODO, entries could be in different folders - yet the first one is used
            rowGs[row.name] = rowG;
        } else {
            rowG.entries.push(row);
            rowG.downloads += row.downloads;
        }
    });
    return Object.values(rowGs);
}
// for testing - use like await sleep(10000);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class DbHandler {
    constructor(dbPath) {
        this.db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, err => {
            if (err) {
                console.error(`Failed to open ${dbPath}. ${err.message}`);
                throw err;
            }
        });
    }
    async initFolderStructure() {
        const rowid2Row = {};
        this.parentsMap = {};
        this.childrenIdMap = {};
        this.folderPaths = {};

        const rows = await this.allAsync(`SELECT rowid, name, desc, type, folder FROM entry2 WHERE type = ? AND is_deleted = ?`, ['coll', 0]);
        rows.forEach(row => {
            rowid2Row[row.rowid] = row;
            this.childrenIdMap[row.rowid] = [row.rowid];
         });
        rows.forEach(row => {
            const child = row.rowid;
            this.parentsMap[child] = [row];
            while (row.folder != 0) { 
                this.childrenIdMap[row.folder].push(row.rowid);
                row = rowid2Row[row.folder];
                this.parentsMap[child].push(row);
            }
        });
        for (let [rowid, parents] of Object.entries(this.parentsMap)) {
            parents.reverse(); // in-place - order bigger to smaller
            this.folderPaths[rowid] = parents.map(p => createFileName(p.name, p.desc, p.rowid, p.type)).join('/');
        }
    }
    getUrl(row) {
        return path.join(this.folderPaths[row.folder] || '', createFileName(row.name, row.desc, row.rowid, row.type));
    }

    async search(terms) { // folders are not searched
        // sqlite will error if number of experessions is more than 1000, so do in batches
        const batchSize = 800, finalRows = []; 
        for (let i = 0; i < terms.length; i += batchSize) {
            const whereClouse = terms.slice(i, i + batchSize).map(term => `name LIKE '%${term}%'`).join(' OR ');
            const rows = await this.allAsync(`SELECT rowid, * FROM entry WHERE ${whereClouse}`, []);
            finalRows.push(...rows);
        }
        return groupRowsByName(finalRows);
    }
    async getFolder(folders) { // a chain of folders
        // get folders
        const likeTerm = JSON.stringify(folders).slice(0, -1) + '%"]'; // remove last char and add %"]
        //console.log(likeTerm);
        let folderRows = await this.allAsync(`SELECT folders, COUNT(*) AS num_files, SUM(size) as size FROM entry WHERE folders LIKE ? GROUP BY folders`, [likeTerm]);
        folderRows = folderRows.filter(gRow => JSON.parse(gRow.folders).length == folders.length + 1);
        folderRows.forEach(gRow => gRow.name = JSON.parse(gRow.folders).slice(-1)[0]);
        // get entries
        const rows = await this.allAsync(`SELECT rowid, * FROM entry WHERE folders = ?`, [JSON.stringify(folders)]);
        return [ groupRowsByName(rows), folderRows ];
    }

    async incrementDownloads(rowid) { // must be a file
        return this.runAsync(`UPDATE entry2 SET downloads = downloads + 1 WHERE rowid = ?`, [rowid]);
    }

    async getEntry(rowid) {
        return this.getAsync(`SELECT rowid, * FROM entry2 WHERE rowid = ?`, [rowid]);
        // in case of coll, parents contains itself
        //return [entry, this.parentsMap[entry.type == 'coll' ? entry.rowid : entry.folder]];
    }

    async getFolderGeneric(rowid, folderIds, pastDate = '0') { // must be folder
        const rows = await this.allAsync(`SELECT e.rowid, e.*, e2.name AS folder_name FROM entry2 e 
                                        INNER JOIN entry2 e2 ON e.folder = e2.rowid
                                        WHERE e.folder IN (${folderIds.join(',')}) AND e.is_deleted = 0 AND e.date_added > ?`, [pastDate]);
        return [rows, this.parentsMap[rowid]];
        //return groupRowsByName(rows);
    }
    async getChildren(rowid) { // must be folder
        return this.getFolderGeneric(rowid, [rowid], '0');
        //return this.allAsync(`SELECT rowid, * FROM entry2 WHERE folder = ?`, [rowid]);
    }
    async getAll(rowid) { // must be folder
        return this.getFolderGeneric(rowid, childrenIdMap[rowid], '0');
    }
    async getRecentlyAdded(rowid, pastDate) { // must be folder
        return this.getFolderGeneric(rowid, childrenIdMap[rowid], pastDate);
        //const inFolders = childrenIdMap[rowid].join(', ');
        //const rows = await this.allAsync(`SELECT rowid, * FROM entry2 WHERE folder IN (${inFolders}) AND date_added > ?`, [pastDate]);
        //return [rows, this.parentsMap[rowid]];
        //return groupRowsByName(rows);
    }
    
    async allAsync(sql, params) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error(`Sqlite All Failed ${sql}. ${err.message}`);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
    async getAsync(sql, params) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    console.error(`Sqlite All Failed ${sql}. ${err.message}`);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }
    async runAsync(sql, params) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) {
                    console.error(`Sqlite All Failed ${sql}. ${err.message}`);
                    reject(err);
                } else {
                    resolve(this.lastID); // incase of insert the lastID will be the last inserted rowid
                }
            });
        });
    }
    close() {
        this.db.close((err) => {
            if (err) {
                console.error(`Closing db failed ${err.message}`);
            } else {
                console.log('Sqlite db closed.');
            }
        }); 
    }
}

module.exports = { DbHandler, parseFileName, createFileName };