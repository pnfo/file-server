/**
 * Db table format as follows
 * CREATE TABLE `entry` (
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
        this.rowid2Row = {};
        this.parentsMap = {};
        this.childrenIdMap = {};
        this.folderPaths = {};

        //const rows = await this.allAsync(`SELECT rowid, name, desc, type, folder FROM entry WHERE type = ? AND is_deleted = ?`, ['coll', 0]);
        const rows = await this.allAsync(`SELECT e.rowid, e.name, e.desc, e.type, e.folder, 
                                        COUNT(e.rowid) AS num_entries, SUM(e2.size) AS total_size FROM entry e
                                        INNER JOIN entry e2 ON e2.folder = e.rowid
                                        WHERE e.type = ? AND e.is_deleted = ? GROUP BY e2.folder`, ['coll', 0]);
        rows.forEach(row => {
            this.rowid2Row[row.rowid] = row;
            this.childrenIdMap[row.rowid] = [row.rowid];
         });
        rows.forEach(row => {
            const child = row.rowid;
            this.parentsMap[child] = [row];
            while (row.folder != 0) { 
                this.childrenIdMap[row.folder].push(row.rowid);
                row = this.rowid2Row[row.folder];
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

    async search(rowid, terms) { // folders are not searched
        // sqlite will error if number of experessions is more than 1000, so do in batches
        const batchSize = 800, finalRows = []; 
        for (let i = 0; i < terms.length; i += batchSize) {
            const whereClouse = terms.slice(i, i + batchSize).map(term => `e.name LIKE '%${term}%'`).join(' OR ');
            const [rows, _1] = await this.getFolderGeneric(rowid, this.childrenIdMap[rowid], '0', ` AND (${whereClouse})`);
            //const rows = await this.allAsync(`SELECT rowid, * FROM entry WHERE ${whereClouse}`, []);
            finalRows.push(...rows);
        }
        return finalRows;
    }

    async incrementDownloads(rowid) { // must be a file
        return this.runAsync(`UPDATE entry SET downloads = downloads + 1 WHERE rowid = ?`, [rowid]);
    }

    async getEntry(rowid) {
        return this.getAsync(`SELECT rowid, * FROM entry WHERE rowid = ?`, [rowid]);
        // in case of coll, parents contains itself
        //return [entry, this.parentsMap[entry.type == 'coll' ? entry.rowid : entry.folder]];
    }

    async getFolderGeneric(rowid, folderIds, pastDate, extraWhere) { // must be folder
        // in case of rowid = 0 (root folder), folderIds will be undefined and all rows need to be considered
        const folderFilter = folderIds ? `e.folder IN (${folderIds.join(',')}) AND ` : '';
        // LEFT JOIN needed when querying the rootfolder, e.folder will be 0
        const rows = await this.allAsync(`SELECT e.rowid, e.*, e2.name AS folder_name FROM entry e 
                                        LEFT JOIN entry e2 ON e.folder = e2.rowid
                                        WHERE ${folderFilter} e.is_deleted = 0 AND e.date_added > ?${extraWhere}`, [pastDate]);
        // for the folder entries add extra fields (num files and total size of those files)
        rows.filter(row => row.type == 'coll').forEach(row => {
            row.num_entries = this.rowid2Row[row.rowid].num_entries;
            row.total_size = this.rowid2Row[row.rowid].total_size;
        });
        rows.sort((a, b) => { // folers come first, then sort by name
            if (a.type == b.type || (a.type != 'coll' && b.type != 'coll')) {
                if (a.name == b.name) return 0;
                return (b.name < a.name) - (b.name > a.name);
            }
            return (b.type == 'coll') - (a.type == 'coll');
        });
        return [rows, this.parentsMap[rowid]];
    }
    async getChildren(rowid) { // must be folder
        return this.getFolderGeneric(rowid, [rowid], '0', '');
    }
    async getAll(rowid) { // must be folder
        return this.getFolderGeneric(rowid, this.childrenIdMap[rowid], '0', '');
    }
    async getRecentlyAdded(rowid, pastDate) { // must be folder
        return this.getFolderGeneric(rowid, this.childrenIdMap[rowid], pastDate, '');
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