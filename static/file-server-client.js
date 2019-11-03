/**
 * Created by Janaka on 2019-10-27.
 */
var resultSettings = {
    minQueryLength: 2,
    maxSinglishLength: 10,
    maxResults: 100,  // search stopped after getting this many matches
    searchDelay: 400,
};
this.requestTimer = '';

$('.search-bar').on('input', function(e) {
    performSearch(e);
}); // TODO: give focus to the search bar on page load

let prevQuery = '';
const resultsDiv = $('#search-results'), statusDiv = $('#search-status');
async function performSearch(e) {
    e.stopPropagation();
    var query = $('.search-bar').val().toLowerCase();
    console.log(query);
    if (query == prevQuery) return;
    prevQuery = query; // prevent unnecessary fetch requests
    resultsDiv.empty();
    if (query.length < resultSettings.minQueryLength) {
        statusDiv.text(`අඩුම තරමේ අකුරු ${resultSettings.minQueryLength} ක් වත් ඇතුළු කරන්න.`);
        return;
    }
    // query could be in roman script
    if (isSinglishQuery(query) && query.length > resultSettings.maxSinglishLength) {
        statusDiv.text(`සිංග්ලිෂ් වලින් සෙවීමේ දී උපරිමය අකුරු ${resultSettings.maxSinglishLength} කට සීමා කර ඇත.`);
        return;
    }
    this.scheduleSearchIndex(query); // delay to prevent multiple queries being sent when typing
}

function isSinglishQuery(query) {
	return /[A-Za-z]/.test(query);
}
function scheduleSearchIndex(query) {
    if (requestTimer) clearTimeout(requestTimer);
    requestTimer = setTimeout(() => sendSearchQuery(query), resultSettings.searchDelay);
}

async function sendSearchQuery(query) {
    statusDiv.html(`<i class="fad fa-spinner fa-spin"></i> සොයමින්... මදක් ඉවසන්න.`);
    const apiEndpoint = $('div.content').attr('web-url') + 'api/search/';
    const response = await fetch(apiEndpoint, {
        method: 'POST', 
        headers: { 'Content-Type': 'text/plain' }, 
        body: JSON.stringify({query, entryId: $('div.content').attr('entry-id')})
    });
    const resultsHtml = await response.text();
    //console.log(resultsHtml);
    resultsDiv.html(resultsHtml);
    const numResults = resultsDiv.children('table').attr('size') || 0;
    console.log(`Search query returned ${numResults} results`);
    if (!numResults) {
        statusDiv.text(`“${query}” යන සෙවුම සඳහා ගැළපෙන නම් කිසිවක් හමුවුයේ නැත. වෙනත් සෙවුමක් උත්සාහ කර බලන්න.`);
    } else if (numResults < resultSettings.maxResults) {
        statusDiv.text(`“${query}” යන සෙවුම සඳහා ගැළපෙන නම් ${numResults} ක් හමුවුනා.`);
    } else {
        statusDiv.text(`ඔබගේ සෙවුම සඳහා ගැළපෙන නම් ${numResults} කට වඩා හමුවුනා. එයින් මුල් ${resultSettings.maxResults} පහත දැක්වේ.`);
    }
}

const clipb = new ClipboardJS('.share-icon', {
    text: function(icon) {
        const entryId = $(icon).parents('tr[entry-id]').attr('entry-id');
        return $('div.content').attr('web-url') + entryId;
    }
});
clipb.on('success', e => showToast('link එක copy කර ගත්තා. ඔබට අවශ්‍ය තැන paste කරන්න.'));

function showToast(toastMsg) {
    var toast = $('#toast').text(toastMsg).show();
    // After 3 seconds, remove the show class from DIV
    setTimeout(function(){ toast.hide(); }, 3000);
}
/*
// old code


/*$('.TOC-text .material-icons.parent').click(e => {
    const icon = $(e.currentTarget);
    icon.parent().toggleClass('closed').siblings('.TOC-children').toggle();
    icon.text(icon.text() == 'expand_less' ? 'arrow_downward' : 'expand_less');
});

$(document).keydown(function(e) {
    switch(e.which) {
        case 37: // left
        $('nav.bottom a.prev').get(0).click();
        break;

        case 39: // right
        $('nav.bottom a.next').get(0).click();
        break;

        default: return; // exit this handler for other keys
    }
    e.preventDefault(); // prevent the default action (scroll / move caret)
});
*/
/*$('body').on('click', 'a.entry', async function(e) {
    const entryElem = $(e.currentTarget);
    const response = await fetch('/api/increment/' + entryElem.attr('entry-id'));
    console.log(response);
    downloadFile(entryElem.attr('url'));
});

const rootFileUrl = "https://tipitaka.lk/files/public/library/";
function downloadFile(url) {
    var a = window.document.createElement('a');
    a.href = rootFileUrl + url;
    a.target = '_blank';
    a.download = url.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a)
}*/