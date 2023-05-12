
import fs from 'fs'
import path from 'path'
import { S3Handler } from './s3-hander.js'
import { getTypeInfo } from './vue-handler.js'
import util from 'util'
import {exec} from 'child_process'
const runCommand = util.promisify(exec)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sh = new S3Handler('library')

const downloadFolder = '/Volumes/1TB/ebooks-new', thumbFolder = '/Volumes/1TB/ebooks-new/Images'
const thumbFile = (id, num, type) => `${thumbFolder}/${id}-${num}.${type}`

async function getNumPages(pdfPath) {
    const numPagesCommand = `mdls -raw -attr kMDItemNumberOfPages '${pdfPath}'` // works on mac
    let {stdout} = await runCommand(numPagesCommand)
    while(!stdout || isNaN(stdout)) {
        await sleep(500)
        stdout = (await runCommand(numPagesCommand)).stdout
    }
    return parseInt(stdout)
}

async function downloadFile(pdfFilePath, Key) {
    const writeStream = fs.createWriteStream(pdfFilePath);
    const readStream = await sh.readFile(Key)
    readStream.pipe(writeStream)
    await new Promise((resolve, reject) => { // Wait for the file to finish writing
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
    });
}

async function recompute(file, recomputeAll) {
    const pdfFilePath = path.join(downloadFolder, file.Key), pdfFolderPath = path.join(downloadFolder, file.prefix)
    let fileDownloaded = false
    // download the file from s3 if not exists or if the sizes differ
    if (!fs.existsSync(pdfFilePath)) {
        if (!fs.existsSync(pdfFolderPath)) fs.mkdirSync(pdfFolderPath, {recursive: true})
        console.log(`file ${file.id} does not exist. downloading from s3. name ${file.fileName}`)
        await downloadFile(pdfFilePath, file.Key)
        fileDownloaded = true
    } else {
        const size = fs.statSync(pdfFilePath).size
        if (size != file.Size) {
            console.log(`file ${file.id} local size ${size} different from s3 size ${file.Size}`)
            await downloadFile(pdfFilePath, file.Key)
            fileDownloaded = true
        }
    }

    if (file.type != 'pdf') return
    if (!fileDownloaded && !recomputeAll) {
        console.log(`files ${file.id} already exists. not recomputing`)
        return
    }

    // compute thumbs
    const numPages = await getNumPages(pdfFilePath), 
        pages = numPages > 1 ? [0, Math.floor(numPages / 2)] : [0]
    console.log(`file ${file.id} has ${numPages} pages, compute thumbs for pages ${pages}, file size ${Math.round(file.Size/1024/1024)} MB`)
    
    // if jpgs are created directly the backgrounds are sometimes come out as black, so create pngs and then change to jpg
    const options = '-background white -flatten -alpha remove -alpha off'
    const getCommand = (p, i) => `convert ${options} -density 200 -resize x1500 '${pdfFilePath}[${p}]' ${thumbFile(file.id, i, 'png')}`
    await Promise.all(pages.map((p, i) => runCommand(getCommand(p, i))))

    // convert pngs to jpg and delete the png files (since pngs are big)
    await Promise.all(pages.map((p, i) => runCommand(`convert ${thumbFile(file.id, i, 'png')} -quality 40 ${thumbFile(file.id, i, 'jpg')}`)))
    await Promise.all(pages.map((p, i) => fs.promises.unlink(thumbFile(file.id, i, 'png'))))
    
    // put the files back in the s3
    const uploadPromises = pages.map((page, index) => {
        const uploadParams = {
            Key: `thumbs/${file.id}-${index}.jpg`,
            Body: fs.createReadStream(thumbFile(file.id, index, 'jpg')),//`${thumbFolder}/${file.id}-${index}.jpg`),
            ContentType: getTypeInfo('jpg')[3],
            Metadata: {
                'page-number': (page + 1).toString(),
            },
            ACL: 'public-read',
        }
        return sh.upload(uploadParams)
    })
    await Promise.all(uploadPromises)
}

async function recomputeThumbnails(startId, endId = 0, recomputeAll = false) {
    if (!endId) endId = startId
    const files = await sh.list('', true)
    const selected = files.filter(({id}) => id >= startId && id <= endId)
    for (const file of selected) {
        await recompute(file, recomputeAll)
    }
    console.log(`finished for ${selected.length} files`)
}

/**
 * download and sync files that do not exist in the local directory
 * if a file is downloaded compute the thumb photos, if the recomputeAll is true compute even if not downloaded
 * some thumbs have been manually edited to remove whitespace, so recompute only the new pdfs
 * startId and endId are inclusive
 **/
recomputeThumbnails(1010, 1010, false)