import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { news } from '../../stores'; 
import { dynasty } from '../leagueInfo';

const REDDIT_DYNASTY = 'https://www.reddit.com/r/DynastyFF/new.json';
const REDDIT_FANTASY = 'https://www.reddit.com/r/fantasyfootball/new.json';
const SERVER_API = '/api/fetch_serverside_news';

export const getNews = async (servFetch, bypass = false) => {
    const currentNews = get(news);
    if (currentNews && currentNews[0] && !bypass) { 
        return { articles: currentNews, fresh: false };
    }

    const smartFetch = servFetch ?? fetch;

    try {
        const serverData = await smartFetch(SERVER_API, { compress: true })
            .then(res => res.ok ? res.json() : [])
            .catch(() => []);

        const targetRedditFeed = dynasty ? REDDIT_DYNASTY : REDDIT_FANTASY;
        const redditData = await getFeed(targetRedditFeed, processReddit);

        const safeServerData = Array.isArray(serverData) ? serverData : [];
        const safeRedditData = Array.isArray(redditData) ? redditData : [];

        const combined = [...safeRedditData, ...safeServerData];
        const articles = combined.sort((a, b) => (b.ts || 0) - (a.ts || 0));

        news.update(() => articles);
        return { articles, fresh: true };
    } catch (globalErr) {
        console.error("Global news compilation failed, gracefully fallback to clean screen state:", globalErr);
        return { articles: [], fresh: true };
    }
};

const getFeed = async (feed, callback) => {
    try {
        const res = await fetch(feed, { compress: true });
        if (!res || !res.ok) return [];
        
        const data = await res.json();
        if (data && data.data) { 
            return callback(data.data); 
        }
        return [];
    } catch (err) { 
        // 403 Forbidden errors from Reddit's CORS policy are caught safely here
        console.warn(`External feed request to ${feed} was blocked by the host server.`);         
        return []; 
    }
};

const processReddit = (rawArticles) => {
    if (!rawArticles || !rawArticles.children) return [];
    const bannedAuthors = ["AutoModerator", "FFBot", "Brookskbrothers", "FTAKJ"];
    const bannedIcons = ["self", "thumbnail", "default"];
    let finalArticles = [];
    
    for (const rawArticle of rawArticles.children) {
        const data = rawArticle.data;
        if (!data || bannedAuthors.includes(data.author)) continue; 
        
        const ts = data.created_utc * 1000;
        const d = new Date(ts);
        const icon = !bannedIcons.includes(data.thumbnail) ? data.thumbnail : `newsIcons/${data.subreddit}.png`;
        const date = stringDate(d); 
        
        let article = `<a href="${data.url}" class="body-link">${data.url}</a>`;
        if (data.selftext_html) { 
            article = decodeHTML(data.selftext_html); 
        }
        
        finalArticles.push({ 
            title: data.title, 
            article, 
            link: `https://www.reddit.com${data.permalink}`, 
            author: `${data.subreddit_name_prefixed} - u/${data.author}`, 
            date, 
            icon,
            ts
        });
    }
    return finalArticles;
};

const htmlEntities = {
    nbsp: ' ', cent: '¢', pound: '£', yen: '¥', euro: '€', copy: '©', reg: '®', lt: '<', gt: '>', quot: '"', amp: '&', apos: '\''
};

function decodeHTML(str) {
    if (!str) return '';
    return str.replace(/\&([^;]+);/g, function (entity, entityCode) {
        let match;
        if (entityCode in htmlEntities) {
            return htmlEntities[entityCode];
        } else if (match = entityCode.match(/^#x([\da-fA-F]+)$/)) {
            return String.fromCharCode(parseInt(match[1], 16));
        } else if (match = entityCode.match(/^#(\d+)$/)) {
            return String.fromCharCode(~~match[1]);
        } else {
            return entity;
        }
    });
}

export const stringDate = (d) => { 
    return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} ${d.getHours() % 12}:${(d.getMinutes() < 10 ? '0' : '') + d.getMinutes()}${d.getHours() / 12 >= 1 ? "PM" : "AM"}`; 
};

// --- NEW FUNCTION TO SATISFY PLAYER CARD EXPORT ---
export const getPlayerNews = async (playerId) => {
    try {
        const res = await fetch('https://api.sleeper.app/v1/news/nfl');
        if (!res.ok) return [];
        const newsData = await res.json();
        // Filter the global news block down to just the requested player
        return newsData.filter(item => item.player_id === playerId);
    } catch (e) {
        console.error("Player news fetch failed", e);
        return [];
    }
};