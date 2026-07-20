export const stringDate = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    return d.toLocaleDateString();
};

export const getNews = async (feedType = 'NFL') => {
    try {
        // Hitting the universal Vite proxy
        const url = "/api/espn/apis/site/v2/sports/football/nfl/news?limit=100";
        
        const res = await fetch(url);
        const data = await res.json();
        
        let articles = data.articles.map(article => ({
            title: article.headline || '',
            author: article.byline || 'ESPN',
            date: article.published ? new Date(article.published).toLocaleDateString() : '',
            article: article.description || article.story || '',
            icon: 'https://a.espncdn.com/favicon.ico',
            rawCategories: JSON.stringify(article.categories || [])
        }));

        if (feedType === 'FANTASY') {
            articles = articles.filter(a => 
                a.rawCategories.toLowerCase().includes('fantasy') ||
                a.title.toLowerCase().includes('fantasy') || 
                a.article.toLowerCase().includes('fantasy')
            );
        }

        return { articles, stale: false };
    } catch (e) {
        console.error(`${feedType} news fetch failed:`, e);
        return { articles: [], stale: true };
    }
}