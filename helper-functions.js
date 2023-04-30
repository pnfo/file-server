
import fs from 'fs'
import path from 'path'
import vkb from 'vkbeautify'
//import sqlite3 from 'sqlite3'

function extractSqlite(dbFile, outputFile) {
    const db = new sqlite3.Database(dbFile);

    const tableName = 'entry';

    db.all(`SELECT rowid as id, * FROM ${tableName}`, [], (err, rows) => {
        if (err) {
            throw err
        }

        const idToDownloads = {};
        rows.forEach(row => {
          if (idToDownloads[row.id]) console.error(`id ${row.id} already exists`)
          if (row.type == 'coll') return
          idToDownloads[row.id] = {downloads: row.downloads, dateAdded: row.date_added}
        });

        fs.writeFileSync(outputFile, vkb.json(JSON.stringify(idToDownloads)), 'utf-8')
        console.log(`extracted ${Object.keys(idToDownloads).length} files from ${dbFile} to ${outputFile}`)
    });

    db.close();
}
//extractSqlite('cloud/cloud.db', 'cloud/id-to-info-dev.json')


import { S3Handler } from './s3-hander.js'
import { getTypeInfo } from './vue-handler-new.js'

const sh = new S3Handler('library')
// recursively uploads a local folder to s3, preserving path and file names
async function uploadFolderToS3(inputPath, extraPrefixes) {
  const files = await fs.promises.readdir(inputPath);
 
  for (const file of files) {
    const filePath = path.join(inputPath, file)
    if (!/\{\d+\}/.test(file)) {
      console.error(`file ${file} does not have an id. ${filePath}`)
    }
    const stats = await fs.promises.stat(filePath);
 
    if (stats.isFile()) {
      const uploadParams = {
        Key: [...extraPrefixes, file].join('/'),
        Body: fs.createReadStream(filePath), //await fs.promises.readFile(filePath),
        ContentType: getTypeInfo(file.split('.').slice(-1)[0])[3],
        Metadata: {
          'last-modified': stats.mtime.toISOString(),
        },
      };
 
      try {
        await sh.upload(uploadParams)
        console.log(`uploaded ${filePath} to S3 bucket at ${uploadParams.Key}`);
      } catch (err) {
        console.error(`Error uploading ${filePath} to S3 bucket at ${uploadParams.Key}`, err);
      }
    } else {
      await uploadFolderToS3(filePath, [...extraPrefixes, file])
    }

  }
};
const folderPath = 'මෘදුකාංග{450}'
//const folderPath = 'රේරුකානේ චන්ද්‍රවිමල හිමි{462}'
//const folderPath = 'වෙනත් ත්‍රිපිටක{682}'
//const folderPath = 'වෙනත්{514}'
//const folderPath = 'සිංහල අට්ඨකථා{623}'
//const folderPath = 'සිංහල භාෂාව{949}'
//const folderPath = 'සූත්‍ර{645}'
uploadFolderToS3('/datadrive/public/library/' + folderPath, folderPath.split('/'))
//uploadFolderToS3('/datadrive/public/library', [])
//uploadFolderToS3('/Users/janaka/Downloads/test{1}', ['test{1}'])