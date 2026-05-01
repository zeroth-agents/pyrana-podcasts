/**
 * RSS feed XML — pure build/parse helpers.
 * Read/write of the actual file lives in Github.gs.
 */

function parseEpisodes(xml) {
  if (!xml) return [];
  const episodes = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const x = match[1];
    episodes.push({
      title:       extractXml(x, /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/),
      pubDate:     new Date(extractXml(x, /<pubDate>([\s\S]*?)<\/pubDate>/)),
      audioUrl:    extractXml(x, /<enclosure url="([^"]+)"/),
      audioSize:   parseInt(extractXml(x, /length="(\d+)"/) || '0', 10),
      guid:        extractXml(x, /<guid[^>]*>([\s\S]*?)<\/guid>/),
      description: extractXml(x, /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/),
      durationSec: parseInt(extractXml(x, /<itunes:duration>(\d+)<\/itunes:duration>/) || '300', 10),
    });
  }
  return episodes;
}

function extractXml(haystack, regex) {
  const m = haystack.match(regex);
  return m ? m[1] : '';
}

function buildRssXml(episodes) {
  const p = CONFIG.PODCAST;
  const feedUrl = CONFIG.GITHUB.pagesBaseUrl + '/podcast.xml';
  const coverUrl = CONFIG.GITHUB.pagesBaseUrl + '/' + p.coverArtPath;

  const items = episodes.map(function (ep) {
    return '' +
'    <item>\n' +
'      <title><![CDATA[' + ep.title + ']]></title>\n' +
'      <description><![CDATA[' + ep.description + ']]></description>\n' +
'      <pubDate>' + new Date(ep.pubDate).toUTCString() + '</pubDate>\n' +
'      <enclosure url="' + ep.audioUrl + '" length="' + ep.audioSize + '" type="audio/mpeg"/>\n' +
'      <guid isPermaLink="false">' + ep.guid + '</guid>\n' +
'      <itunes:duration>' + ep.durationSec + '</itunes:duration>\n' +
'      <itunes:explicit>' + (p.explicit ? 'true' : 'false') + '</itunes:explicit>\n' +
'    </item>';
  }).join('\n');

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
'<rss version="2.0"\n' +
'     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"\n' +
'     xmlns:content="http://purl.org/rss/1.0/modules/content/"\n' +
'     xmlns:atom="http://www.w3.org/2005/Atom">\n' +
'  <channel>\n' +
'    <atom:link href="' + feedUrl + '" rel="self" type="application/rss+xml"/>\n' +
'    <title>' + p.title + '</title>\n' +
'    <description><![CDATA[' + p.description + ']]></description>\n' +
'    <link>' + p.websiteUrl + '</link>\n' +
'    <language>' + p.language + '</language>\n' +
'    <itunes:author>' + p.author + '</itunes:author>\n' +
'    <itunes:owner>\n' +
'      <itunes:name>' + p.author + '</itunes:name>\n' +
'      <itunes:email>' + p.email + '</itunes:email>\n' +
'    </itunes:owner>\n' +
'    <itunes:category text="' + p.category + '"/>\n' +
'    <itunes:explicit>' + (p.explicit ? 'true' : 'false') + '</itunes:explicit>\n' +
'    <itunes:image href="' + coverUrl + '"/>\n' +
'    <itunes:type>episodic</itunes:type>\n' +
'    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
items + '\n' +
'  </channel>\n' +
'</rss>\n';
}

/**
 * Rough duration estimate based on word count (≈150 wpm conversational pace).
 */
function estimateDuration(scriptTurns) {
  const totalWords = scriptTurns.reduce(function (n, t) {
    return n + t.text.split(/\s+/).length;
  }, 0);
  return Math.round((totalWords / 150) * 60);
}
