const Vue = require('vue');
const vsr = require('vue-server-renderer');

const typeToInfo = {
    'pdf': ['fal fa-file-pdf', 'PDF', 'PDF file එක භාගත කරගන්න', 'application/pdf'],
    'htm': ['fab fa-chrome', 'WEB', 'HTML file එක වෙත පිවිසෙන්න', 'text/html'],
    'lin': ['fal fa-link', 'WWW', 'Link එක වෙත පිවිසෙන්න', ''], // redirect to url
    'col': ['fal fa-folder', 'ගොනුව', 'ගොනුව වෙත පිවිසෙන්න'],
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
        props: ['entry', 'columns'],
        computed: { 
            downloads: function() { return formatNumber(this.entry.downloads); },
            //typeStr: function() { return getTypeInfo(this.entry.type)[1]; },
            sizeStr: function() { return readableSize(this.entry.size); },
            iconStr: function() { return getTypeInfo(this.entry.type)[0]; },
            tipText: function() { return getTypeInfo(this.entry.type)[2]; },
        },
        // folder_name need to be added to the entry/row
        template: `<tr class="entry">
            <td class="name">
                <a class="button entry" :entry-id="entry.rowid" :tip="tipText" :href="entry.rowid">
                    <i v-bind:class="iconStr"></i>
                    <span class="entry-details">{{ entry.name }}</span>
                </a>
            </td>
            <td v-show="columns.includes('folder')" class="folder">{{ entry.folder_name }}</td>
            <td v-show="columns.includes('downloads')" class="downloads">{{ downloads }}</td>
            <td v-show="columns.includes('date_added')" class="date-added">{{ entry.date_added }}</td>
            <td v-show="columns.includes('size')" class="size">{{ sizeStr }}</td>
        </tr>`,
    },
    'entry-list': {
        props: ['entries', 'columns'],
        template: `<table class="entry-list" :size="entries.length">
            <thead><tr>
                <td class="name"><i class="fas fa-book"></i> පොතේ නම</td>
                <td v-show="columns.includes('folder')" class="folder"><i class="fas fa-folder"></i> ගොනුව</td>
                <td v-show="columns.includes('downloads')" class="downloads"><i class="fas fa-tally"></i> භාගත ගණන</td>
                <td v-show="columns.includes('date_added')" class="date-added"><i class="fas fa-calendar"></i> එකතුකළ දිනය</td>
                <td v-show="columns.includes('size')" class="size"><i class="fas fa-size"></i> ප්‍රමාණය</td>
                <td class="share"><i class="fas fa-share"></i> </td>
            </tr></thead>
            <tbody>
                <entry
                    v-for="(entry, index) in entries"
                    v-bind:entry="entry" :columns="columns"
                    v-bind:key="index">
                </entry>
            </tbody>
        </table>`,
    },
    'top-nav': {
        props: ['parents'],
        template: `<nav class="top">
            <a class="button" href="./0/">
                <i class="fas fa-home" style="color: cadetblue;"></i><span>බෞද්ධ පුස්තකාලය</span>
            </a>
            <a class="button" v-for="folder in parents" v-bind:href="'./' + folder.rowid">
                <i class="fas fa-folder"></i><span>{{ folder.name }}</span>
            </a>
            
            <div id="search-content">
                <div id="search-bar-div">
                    <i class="fad fa-search" style="padding-right: 0.5rem;"></i>
                    <input class="search-bar" type="text" placeholder="පොත් සොයන්න">
                    <a class="button" href="./all/">
                        <i class="fas fa-books" style="color: green;"></i><span>සියලු පොත්</span>
                    </a>
                    <a class="button" href="./newly-added/90">
                        <i class="fas fa-fire" style="color: orange;"></i><span>අලුතින් එක් කළ පොත්</span>
                    </a>
                </div>
                <div id="search-status">පොත් සෙවීම සඳහා ඉහත කොටුවේ type කරන්න.</div>
                <div id="search-results"></div>
            </div>
        </nav>`
    },
}

function vueEntryList(entries) {
    return new Vue({
        data: { entries },
        template: `<entry-list v-if="entries.length" v-bind:entries="entries" :columns="columns"></entry-list>`,
    });
}

function vueFullPage(data) {
    return new Vue({
        data: data,
        template: `<div class="content" :entry-id="entryId">
            <top-nav :parents="parents"></top-nav>
            <entry-list v-if="entries.length" v-bind:entries="entries" :columns="columns"></entry-list>
            <div class="empty-placeholder" v-if="!entries.length">මෙම ගොනුව හිස්ය.</div>
        </div>`,
    });
}

let vueRenderer;
function setupVueSSR(htmlTemplateFile) {
    Vue.component('entry', componentList['entry']);
    Vue.component('entry-list', componentList['entry-list']);
    Vue.component('top-nav', componentList['top-nav']);
    const pageRR = vsr.createRenderer({
        template: require('fs').readFileSync(htmlTemplateFile, 'utf-8'),
    });
    const searchRR = vsr.createRenderer();
    return [pageRR, searchRR];
}

module.exports = { vueEntryList, vueFullPage, getTypeInfo, setupVueSSR };