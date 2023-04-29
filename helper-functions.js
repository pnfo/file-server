
const fs = require('fs')
const path = require('path')

function extractSqlite() {
    const sqlite3 = require('sqlite3').verbose();

    const db = new sqlite3.Database('library/library.db');

    const tableName = 'entry';

    db.all(`SELECT rowid as id, * FROM ${tableName}`, [], (err, rows) => {
        if (err) {
            console.log(err);
            return;
        }

        const data = {};
        rows.forEach(row => {
            const id = row.id;
            delete row.id;
            data[id] = row;
        });

        console.log(data);
    });

    db.close();
}


import { S3Handler } from './s3-hander.js'
import { getTypeInfo } from './vue-handler-new.js'

const sh = new S3Handler('library-dev')

const prefix = 'පින්තූර වගු සටහන්{254}/චිත්‍ර කතා';
const localFolderPath = '/Volumes/1TB 1/ebooks/පින්තූර වගු සටහන්{254}/චිත්‍ර කතා';
 
const uploadFolderToS3 = async () => {
  const files = await fs.promises.readdir(localFolderPath);
 
  for (const file of files) {
    const filePath = path.join(localFolderPath, file);
    const stats = await fs.promises.stat(filePath);
 
    if (stats.isFile()) {
      const fileContent = await fs.promises.readFile(filePath);
      const key = `${prefix}/${file}`

      const uploadParams = {
        Body: fileContent,
        ContentType: getTypeInfo(path.extname(filePath).substring(1))[3],
        Metadata: {
          'last-modified': stats.mtime.toISOString(),
        },
      };
 
      try {
        //console.log(uploadParams)
        await sh.upload(key, uploadParams)
        console.log(`Successfully uploaded ${filePath} to S3 bucket at ${key}`);
      } catch (err) {
        console.error(`Error uploading ${filePath} to S3 bucket at ${key}`, err);
      }
    }
  }
};
uploadFolderToS3()