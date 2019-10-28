const Vue = require('vue');
const vsr = require('vue-server-renderer');

var typeToInfo = {
    'pdf': ['fal fa-file-pdf', 'PDF', 'PDF file එක භාගත කරගන්න', 'application/pdf'],
    'htm': ['fab fa-chrome', 'WEB', 'HTML file එක වෙත පිවිසෙන්න', 'text/html'],
    'lin': ['fal fa-link', 'WWW', 'Link එක වෙත පිවිසෙන්න', ''], // redirect to url
    //'col': ['fal fa-folder', 'ගොනුව', 'ගොනුව වෙත පිවිසෙන්න'],
    'zip': ['fal fa-file-archive', 'ZIP', 'ZIP file එක භාගත කරගන්න', 'application/zip'],
    'apk': ['fab fa-android', 'APP', 'android මෘදුකාංගය ලබාගන්න', 'application/octet-stream'],
    'doc': ['fal fa-file-word', 'DOC', 'Word file එක භාගත කරගන්න', 'application/octet-stream'],
    'xls': ['fal fa-file-excel', 'EXCEL', 'Excel වගුව භාගත කරගන්න', 'application/octet-stream'],
    'jpg': ['fal fa-file-image', 'IMAGE', 'පින්තූරය භාගත කරගන්න', 'image/jpeg'],
    'png': ['fal fa-file-image', 'IMAGE', 'පින්තූරය භාගත කරගන්න', 'image/png'],
    'txt': ['fal fa-file-alt', 'TXT', 'TEXT file එක වෙත පිවිසෙන්න', 'text/plain'],
    'mp3': ['fal fa-file-alt', 'MP3', 'TEXT file එක වෙත පිවිසෙන්න', 'audio/mpeg'],
};

function getTypeInfo(type) {
    let type3 = type.substr(0, 3);
    if (type3 == 'jpeg') type3 = 'jpg';
    return typeToInfo[type3];
}
function readableSize(size) {
    const sizeUnits = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (!size) return '';
    const i = parseInt(Math.floor(Math.log(size) / Math.log(1024)));
    return Math.round(size / Math.pow(1024, i), 2) + '' + sizeUnits[i];
}
function formatNumber(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
}
const componentList = {
    'entry': {
        props: ['entry'],
        computed: {
            typeStr: function() { return getTypeInfo(this.entry.type)[1]; },
            sizeStr: function() { return readableSize(this.entry.size); },
            iconStr: function() { return getTypeInfo(this.entry.type)[0]; },
            tipText: function() { return getTypeInfo(this.entry.type)[2]; },
        },
        template: `<a 
            class="button entry" :entry-id="entry.rowid" :tip="tipText" :url="entry.url" :href="'/download/' + entry.rowid">
                <i v-bind:class="iconStr"></i>
                <span class="entry-details">{{ typeStr }} {{ sizeStr }}</span>
            </a>`,
    },
    'book': {
        props: ['book'],
        computed: { downloads: function() { return formatNumber(this.book.downloads); }, },
        template: `<tr class="book">
            <td class="name">{{ book.name }}</td>
            <td class="folders">{{ JSON.parse(this.book.folders).join('/') }}</td>
            <td class="downloads">{{ downloads }}</td>
            <td class="entries">
                <entry
                    v-for="(entry, index) in book.entries"
                    v-bind:entry="entry"
                    v-bind:key="index">
                </entry>
            </td>
        </tr>`,
    },
    'book-list': {
        props: ['books'],
        template: `<table class="book-list" :size="books.length">
            <thead><tr>
                <td class="name"><i class="fas fa-book"></i> පොතේ නම</td>
                <td class="folders"><i class="fas fa-folder"></i> ගොනුව</td>
                <td class="downloads"><i class="fas fa-tally"></i> භාගත ගණන</td>
                <td class="entries"><i class="fas fa-download"></i> භාගත කිරීම</td>
            </tr></thead>
            <tbody>
                <book
                    v-for="(book, index) in books"
                    v-bind:book="book"
                    v-bind:key="index">
                </book>
            </tbody>
        </table>`,
    },
    'folder': {
        props: ['folder'],
        computed: {
            sizeStr: function() { return readableSize(this.folder.size); },
        },
        template: `<tr class="folder">
            <td class="name">{{ folder.name }}</td>
            <td class="downloads">{{ folder.num_files }}</td>
            <td class="entries">
                <a class="button folder" tip="ගොනුව වෙත පිවිසෙන්න" v-bind:href="'./' + folder.name.split(' ').join('-') ">
                    <i class="far fa-folder"></i>
                    <span class="entry-details">ගොනුව {{ sizeStr }}</span>
                </a>
            </td>
        </tr>`,
    },
    'folder-list': {
        props: ['folders'],
        template: `<table class="folder-list">
            <thead><tr>
                <td><i class="fal fa-folders"></i> ගොනුවේ නම</td>
                <td><i class="fal fa-tally"></i> පොත් ගණන</td>
                <td><i class="fal fa-sign-in"></i> ගොනුවට පිවිසෙන්න</td>
            </tr></thead>
            <tbody>
                <folder
                    v-for="(folder, index) in folders"
                    v-bind:folder="folder"
                    v-bind:key="index">
                </folder>
            </tbody>
        </table>`,
    },
    /*'top-nav': {
        props: ['parentFolders'],
        template: `
            <a class="button" v-for="folder in parentFolders" v-bind:href="'./' + folder">
                <i class="fas fa-folder"></i><span>{{ folder }}</span>
            </a>
        </nav>`
    },*/
}

function bookListRenderer(books) {
    Vue.component('entry', componentList['entry']);
    Vue.component('book', componentList['book']);
    Vue.component('book-list', componentList['book-list']);
    const bookList = new Vue({
        data: { books },
        template: `<book-list v-if="books.length" v-bind:books="books"></book-list>`,
    });
    return bookList;
}

function fullPage(books, folders, parentFolders) {
    //Vue.component('top-nav', componentList['top-nav']);
    Vue.component('entry', componentList['entry']);
    Vue.component('folder', componentList['folder']);
    Vue.component('folder-list', componentList['folder-list']);
    Vue.component('book', componentList['book']);
    Vue.component('book-list', componentList['book-list']);
    return new Vue({
        data: {
            books: books,
            folders,
            parentFolders,
        },
        template: `<div class="content">      
            <folder-list v-if="folders.length" v-bind:folders="folders"></folder-list>
            <book-list v-if="books.length" v-bind:books="books"></book-list>
        </div>`,
    });
}

// returns a promise
function pageRenderer(books, folders, parentFolders, context, callback) {
    const renderer = vsr.createRenderer({
        template: require('fs').readFileSync('./index-template.html', 'utf-8'),
    });
    renderer.renderToString(fullPage(books, folders, parentFolders), context, callback);
}

module.exports = { bookListRenderer, pageRenderer, getTypeInfo };