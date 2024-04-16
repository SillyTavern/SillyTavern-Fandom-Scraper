import bodyParser from 'body-parser';
import { Router } from 'express';
import { Chalk } from 'chalk';
import { JSDOM } from 'jsdom';
import * as he from 'he';
import * as wt2pt from 'wikitext2plaintext';

interface Page {
    title: string;
    content: string;
}

interface FandomScrapeRequest{
    fandom: string;
    filter: string;
}

interface PluginInfo {
    id: string;
    name: string;
    description: string;
}

interface Plugin {
    init: (router: Router) => Promise<void>;
    exit: () => Promise<void>;
    info: PluginInfo;
}

const chalk = new Chalk();
const MODULE_NAME = '[SillyTavern-Fandom-Scraper]';

function getFandomId(fandom: string): string {
    try {
        fandom = fandom.trim();
        const url = new URL(fandom);
        const hostname = url.hostname;
        const parts = hostname.split('.');
        const fandomId =  parts[0];

        if (!fandomId) {
            return fandom;
        }

        return fandomId;
    } catch (error) {
        return fandom;
    }
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

async function scrapeFandom(fandom: string, filter?: RegExp): Promise<Page[]> {
    const baseUrl = `https://${fandom}.fandom.com/`;
    let nextPageUrl = '/wiki/Special:AllPages';
    let counter = 0;
    const rawXml = [];

    while (nextPageUrl !== '') {
        const currentUrl = new URL(nextPageUrl, baseUrl);
        const fetchResponse = await fetch(currentUrl, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT } });
        const fetchContent = await fetchResponse.text();
        const dom = new JSDOM(fetchContent);
        const content = dom.window.document.querySelector('.mw-allpages-body');
        const nextPage = dom.window.document.querySelector('.mw-allpages-nav');
        const listOfPages = [];

        if (content) {
            const listOfEntries = content.querySelectorAll('li');
            for (const entry of listOfEntries) {
                if (entry?.textContent) {
                    const pageLink = entry.textContent.replace('(redirect', '') + '\n';
                    // RegExp are stateful, so we need to clone it
                    if (filter && !new RegExp(filter).test(pageLink)) {
                        continue;
                    }
                    listOfPages.push(pageLink);
                }
            }
        }

        const payload = new URLSearchParams();
        payload.append('catname', '');
        payload.append('pages', listOfPages.join('\n'));
        payload.append('curonly', '1');
        payload.append('wpDownload', '1');
        payload.append('wpEditToken', '+\\');
        payload.append('title', 'Special:Export');

        console.log(chalk.green(MODULE_NAME), `Exporting from ${currentUrl}`);
        const response = await fetch(`https://${fandom}.fandom.com/wiki/Special:Export`, {
            method: 'POST',
            body: payload,
            headers: { 'User-Agent': USER_AGENT },
        });

        const data = await response.text();
        rawXml.push(data);

        counter += 1;

        if (nextPage) {
            const nav = nextPage.querySelectorAll('a');
            if (nav.length > 0) {
                if (nav[nav.length - 1]?.textContent?.includes('Next page')) {
                    nextPageUrl = nav[nav.length - 1].href;
                } else {
                    nextPageUrl = '';
                    break;
                }
            } else {
                nextPageUrl = '';
                break;
            }
        } else {
            nextPageUrl = '';
            break;
        }
    }

    return rawXml.flatMap(xml => getPagesFromXml(xml));
}

function wikiToText(wiki: string): string {
    // Parse wiki text to plain text
    const parser = new wt2pt.default();
    let rawContent =  parser.parse(wiki);

    // Remove extra spaces between brackets
    rawContent = rawContent.replace(/\(\s+/g, '(');
    // Remove empty brackets, non-breaking spaces and spaces before commas
    rawContent = rawContent.replace('()', '').replace('\u00a0', ' ').replace(' , ', ', ');
    // Decode HTML entities
    rawContent = he.decode(rawContent);

    // Remove lines starting with 'Category:'
    rawContent = rawContent.split('\n').filter(line => !line.startsWith('Category:')).join('\n');
    // Remove HTML tags (leave only text)
    rawContent = rawContent.replace(/<[^>]*>/g, '');

    return rawContent;
}

function getPagesFromXml(xml: string): Page[] {
    const dom = new JSDOM(xml);
    const pages = dom.window.document.querySelectorAll('page');
    const result = [];
    for (const page of pages) {
        if (page.querySelector('redirect')) {
            continue;
        }

        let titleText = '';
        let contentText = '';

        const namespace = page.querySelector('ns');
        if (namespace?.textContent !== '0') {
            continue;
        }
        const title = page.querySelector('title');
        if (title?.textContent) {
            titleText = title.textContent;
        }
        const content = page.querySelector('text');
        if (content?.textContent) {
            let rawContent = wikiToText(content.textContent);

            contentText = rawContent;
        }
        if (titleText && contentText) {
            result.push({ title: titleText, content: contentText });
        }
    }

    return result;
}

/**
 * Instantiates a regular expression from a string.
 * @param {string} input The input string.
 * @returns {RegExp} The regular expression instance.
 * @copyright Originally from: https://github.com/IonicaBizau/regex-parser.js/blob/master/lib/index.js
 */
function regexFromString(input: string): RegExp | undefined {
    try {
        // Parse input
        const match = input?.match(/(\/?)(.+)\1([a-z]*)/i);

        if (!match) {
            return;
        }

        // Invalid flags
        if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3])) {
            const defaultFlags = 'i';
            return RegExp(input, defaultFlags);
        }

        // Create the regular expression
        return new RegExp(match[2], match[3]);
    } catch {
        return;
    }
}

/**
 * Initialize the plugin.
 * @param router Express Router
 */
export async function init(router: Router): Promise<void> {
    const jsonParser = bodyParser.json();
    router.post('/probe', (_req, res) => {
        return res.sendStatus(204);
    });
    router.post('/scrape', jsonParser, async (req, res) => {
        try {
            const model = req.body as FandomScrapeRequest;
            const fandomId = getFandomId(model.fandom);
            const filter = regexFromString(model.filter);
            console.log(chalk.green(MODULE_NAME), `Scraping ${fandomId} with filter: ${filter ? filter.source : 'none'}`);
            const result = await scrapeFandom(fandomId, filter);
            console.log(chalk.green(MODULE_NAME), `Successfully scraped ${result.length} pages from ${fandomId}!`);
            return res.json(result);
        } catch (error) {
            console.error(chalk.red(MODULE_NAME), 'Scrape failed', error);
            return res.status(500).send('Internal Server Error');
        }
    });

    console.log(chalk.green(MODULE_NAME), 'Plugin loaded!');
}

export async function exit(): Promise<void> {
    console.log(chalk.yellow(MODULE_NAME), 'Plugin exited');
}

export const info: PluginInfo = {
    id: 'fandom',
    name: 'Fandom Scraper',
    description: 'Scrape Fandom wiki pages and export to JSON documents',
};

const plugin: Plugin = {
    init,
    exit,
    info,
};

export default plugin;
