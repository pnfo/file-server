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
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const dbPath = './library.db';
class DbHandler {
    constructor() {
        this.db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, err => {
            if (err) {
                console.error(`Failed to open ${dbPath}. ${err.message}`);
                throw err;
            }
        });
    }
    async search(terms) { // folders are not searched
        //await sleep(10000);
        const whereClouse = terms.map(term => `name LIKE '%${term}%'`).join(' OR ');
        //console.log(whereClouse);
        const rows = await this.allAsync(`SELECT rowid, * FROM entry WHERE ${whereClouse}`, []);
        return groupRowsByName(rows);
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
            this.db.run(sql, params, (err) => {
                if (err) {
                    console.error(`Sqlite All Failed ${sql}. ${err.message}`);
                    reject(err);
                } else {
                    resolve(1);
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