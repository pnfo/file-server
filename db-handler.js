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
        //sqlite3.sqlite3_limit(this.db, sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 10000);
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
    async incrementDownloads(rowid) {
        return this.runAsync(`UPDATE entry SET downloads = downloads + 1 WHERE rowid = ?`, [rowid]);
    }
    async getEntryFromId(rowid) {
        return this.getAsync(`SELECT rowid, * FROM entry WHERE rowid = ?`, [rowid]);
    }
    async getAll() {
        const rows = await this.allAsync(`SELECT rowid, * FROM entry`, []);
        return groupRowsByName(rows);
    }
    async getRecentlyAdded(pastDate) {
        const rows = await this.allAsync(`SELECT rowid, * FROM entry WHERE date_added > ?`, [pastDate]);
        return groupRowsByName(rows);
    }
    async getFolderStructure() {
        const rows = await this.allAsync(`SELECT rowid, name, desc, folder FROM entry2 WHERE type = ? AND is_deleted = ?`, ['coll', 0]);
        const rowid2Row = new Map(), parentsMap = {}, childrenMap = {};
        rows.forEach(row => {
            rowid2Row.set(row.rowid, row);
            childrenMap[row.rowid] = [row.rowid];
         });
        rowid2Row.forEach((row, rowid) => {
            parentsMap[rowid] = [rowid];
            let parent = row.folder;
            while (parent != 0) { 
                parentsMap[rowid].push(parent);
                childrenMap[parent].push(rowid); 
                parent = rowid2Row.get(parent).folder; 
            }
        });
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

module.exports = { DbHandler };