const Vue = require('vue');
const vsr = require('vue-server-renderer');

const typeToInfo = {
    'pdf': ['fad fa-file-pdf', 'PDF', 'PDF file එක භාගත කරගන්න', 'application/pdf', 'darkred'],
    'htm': ['fad fa-file-code', 'WEB', 'HTML file එක වෙත පිවිසෙන්න', 'text/html', 'blue'],
    //'lin': ['fad fa-link', 'WWW', 'Link එක වෙත පිවිසෙන්න', ''], // redirect to url
    'col': ['fad fa-folder', 'ගොනුව', 'ගොනුව වෙත පිවිසෙන්න', '', 'goldenrod'],
    'zip': ['fad fa-file-archive', 'ZIP', 'ZIP file එක භාගත කරගන්න', 'application/zip', 'darkslategrey'],
    'apk': ['fad fa-mobile-android', 'APP', 'android මෘදුකාංගය ලබාගන්න', 'application/octet-stream', 'green'],
    'doc': ['fad fa-file-word', 'DOC', 'Word file එක භාගත කරගන්න', 'application/octet-stream', 'darkblue'],
    'xls': ['fad fa-file-excel', 'EXCEL', 'Excel වගුව භාගත කරගන්න', 'application/octet-stream', 'darkgreen'],
    'jpg': ['fad fa-file-image', 'IMAGE', 'පින්තූරය භාගත කරගන්න', 'image/jpeg', 'purple'],
    'png': ['fad fa-file-image', 'IMAGE', 'පින්තූරය භාගත කරගන්න', 'image/png', 'purple'],
    'txt': ['fad fa-file-alt', 'TXT', 'TEXT file එක වෙත පිවිසෙන්න', 'text/plain', 'black'],
    'mp3': ['fad fa-file-audio', 'MP3', 'ධර්ම දේශනාව භාගත කරගන්න', 'audio/mpeg', 'navy'],
    'unk': ['fad fa-file-alt', 'FILE', 'භාගත කරගන්න', 'application/octet-stream', 'darkgreen'], // unknown types
};

function getTypeInfo(type) {
    let type3 = type.substr(0, 3);
    if (type3 == 'jpeg') type3 = 'jpg';
    return typeToInfo[type3] || typeToInfo['unk'];
}
function readableSize(size) {
    const sizeUnits = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (!size) return '';
    const i = parseInt(Math.floor(Math.log(size) / Math.log(1024)));
    return Math.round(size / Math.pow(1024, i), 2) + ' ' + sizeUnits[i];
}
function formatNumber(num) {
    return num ? num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,') : '';
}

const computedProps = {
    downloads: function() { return formatNumber(this.entry.downloads); },
    //typeStr: function() { return getTypeInfo(this.entry.type)[1]; },
    sizeStr: function() { return readableSize(this.entry.size); },
    iconStr: function() { return getTypeInfo(this.entry.type)[0]; },
    iconStyle: function() { return 'color:' + getTypeInfo(this.entry.type)[4]; },
    tipText: function() { return getTypeInfo(this.entry.type)[2]; },
    details: function() {
        if (this.entry.type != 'coll') return this.entry.desc;
        return `Files: ${this.entry.num_entries}, Size: ${readableSize(this.entry.total_size)}`; 
    },
    name: function() { return `${this.entry.name}${this.entry.type != 'coll'? '.' + this.entry.type : ''}`;},
}

const componentList = {
    'entry': {
        props: ['entry', 'columns'],
        computed: computedProps,
        // folder_name need to be added to the entry/row
        template: `<tr class="entry" :entry-id="entry.rowid">
            <td class="name">
                <a :class="'entry-name ' + entry.type" :tip="tipText" :href="webUrl + entry.rowid">
                    <i v-bind:class="iconStr" :style="iconStyle"></i>
                    <span>
                        <span>{{ name }}</span>
                        <span v-if="details.length" class="entry-details">{{ details }}</span>
                    </span>
                </a>
            </td>
            <td><i class="fad fa-share-alt share-icon"></i></td>
            <td v-show="columns.includes('folder')" class="folder"><a :href="webUrl + entry.folder">{{ entry.folder_name }}</a></td>
            <td v-show="columns.includes('downloads')" class="downloads">{{ downloads }}</td>
            <td v-show="columns.includes('date_added')" class="date_added">{{ entry.date_added }}</td>
            <td v-show="columns.includes('size')" class="size">{{ sizeStr }}</td>
        </tr>`,
    },
    'entry-list': {
        props: ['entries', 'columns'],
        template: `<table class="entry-list" :size="entries.length">
            <thead><tr>
                <td class="name"><i class="fad fa-book"></i> නම</td>
                <td class="share"></td>
                <td v-show="columns.includes('folder')" class="folder"><i class="fad fa-folder"></i> ගොනුව</td>
                <td v-show="columns.includes('downloads')" class="downloads"><i class="fad fa-tally"></i><span class="ss-hide"> භාගත ගණන</span></td>
                <td v-show="columns.includes('date_added')" class="date_added"><i class="fad fa-calendar"></i><span class="ss-hide"> එකතුකළ දිනය</span></td>
                <td v-show="columns.includes('size')" class="size"><i class="fad fa-database"></i><span class="ss-hide"> ප්‍රමාණය</span></td>
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
        props: ['parents', 'entryId'],
        template: `<div>
            <nav class="top">
                <div class="nav-link">
                    <a :href="webUrl + '0'"><i class="fad fa-home" style="color: cadetblue;"></i><span>{{ rootFolderName }}</span></a>
                    <i class="fad fa-caret-right" style="color: gray; font-size: 1rem;"></i>
                </div>
                <div v-for="folder in parents" class="nav-link">
                    <a v-bind:href="webUrl + folder.rowid">
                        <i class="fad fa-folder" style="color:goldenrod;"></i><span>{{ folder.name }}</span>
                    </a>
                    <i class="fad fa-caret-right" style="color: gray; font-size: 1rem;"></i>
                </div>
            </nav>

            <div id="search-content">
                <div id="search-bar-div">
                    <i class="fad fa-search" style="padding: 0rem 0.3rem;"></i>
                    <input class="search-bar" type="text" :placeholder="fileTypeName + ' සොයන්න'">
                    <a class="button" :href="webUrl +  entryId + '/all'">
                        <i class="fas fa-books" style="color: green;"></i><span>සියලු<span class="ss-hide">{{ ' ' + fileTypeName }}</span></span>
                    </a>
                    <a class="button" :href="webUrl + entryId + '/newly-added/90'">
                        <i class="fas fa-fire" style="color: orange;"></i><span>අලුත්<span class="ss-hide">{{ ' ' + fileTypeName }}</span></span>
                    </a>
                </div>
                <div id="search-status">{{ 'මෙම ගොනුව තුළ ' + fileTypeName + ' සෙවීම සඳහා ඉහත කොටුවේ type කරන්න.' }}</div>
                <div id="search-results"></div>
            </div>
        </div>`
    },
}

function vueSearchResult(data) {
    return new Vue({
        data: data,
        template: `<entry-list v-if="entries.length" v-bind:entries="entries" :columns="columns"></entry-list>`,
    });
}

function vueListPage(data) {
    return new Vue({
        data: data,
        template: `<div class="content" :entry-id="entryId" :web-url="webUrl">
            <top-nav :parents="parents" :entry-id="entryId"></top-nav>
            <entry-list v-if="entries.length" v-bind:entries="entries" :columns="columns"></entry-list>
            <div class="empty-placeholder" v-if="!entries.length">මෙම ගොනුව හිස්ය.</div>
        </div>`,
    });
}

function vueFilePage(data) {
    return new Vue({
        data: data,
        computed: computedProps,
        template: `<div class="content" :entry-id="entryId" :web-url="webUrl">
            <top-nav :parents="parents" :entry-id="entryId"></top-nav>
            
            <div class="file-info">
                <div :class="'file-name ' + entry.type">
                    <i :class="iconStr" :style="iconStyle"></i>
                    <span>{{ name }}</span>
                </div>
                <div v-if="entry.type == 'mp3'">
                    <audio controls :src="webUrl +  entryId + '/download'" preload="auto">
                        Your browser does not support the <code>audio</code> element.
                    </audio>
                </div>
                
                <div class="downloads"><span>භාගත කරන ලද වාර ගණන : </span>{{ downloads }}</div>
                <div class="date_added"><span>වෙබ් අඩවියට ඇතුල් කල දිනය : </span>{{ entry.date_added }}</div>
                <div class="size"><span>file එකේ ප්‍රමාණය (size) : </span>{{ sizeStr }}</div>

                <div class="download-button">
                    <a class="button" :href="webUrl +  entryId + '/download'">
                        <i class="fas fa-download" style="color: green;"></i><span>{{ tipText }}</span>
                    </a>
                </div>

                <div>
                    <a class="button share-icon">
                        <i class="fad fa-share-alt"></i> share කිරීම සඳහා link එකක් ලබාගන්න
                    </a>
                </div>

                <div v-if="details.length" class="entry-details">{{ details }}</div>
                <div v-if="details.length < 10" class="file-details">මේ පොත ඔබ කියවා තිබේනම් හෝ පොත ගැන යම් විස්තරයක් දන්නේ නම් 
                    මේ පිටුවට පැමිණෙන අයට දැනගැනීම පිණිස මෙතැන පලකිරීමට සුදුසු යම් විස්තරයක් හැඳින්වීමක් ඔබට ලියා අප වෙත email කරන්න. 
                    පොතේ link එකද සඳහන් කිරීමට අමතක කරන්න එපා. සිංහලෙන් හෝ ඉංග්‍රීසියෙන් ලියන්න. සිංග්ලිෂ් වලින් ලිවීමෙන් වලකින්න. 
                </div>
            </div>
        </div>`,
    });
}

//let webUrl;
function setupVueSSR(config) {
    //webUrl = webUrlRoot;
    Vue.component('entry', componentList['entry']);
    Vue.component('entry-list', componentList['entry-list']);
    Vue.component('top-nav', componentList['top-nav']);
    Vue.mixin({ // pass in some global variables
        data: () => { return { 
            webUrl: config.webUrlRoot, 
            fileTypeName: config.fileTypeName,
            rootFolderName: config.rootFolderName,
        }; },
    });
    const pageRR = vsr.createRenderer({
        template: require('fs').readFileSync(config.indexHtmlTemplate, 'utf-8'),
    });
    const searchRR = vsr.createRenderer();
    return [pageRR, searchRR];
}

module.exports = { vueSearchResult, vueListPage, vueFilePage, getTypeInfo, setupVueSSR };