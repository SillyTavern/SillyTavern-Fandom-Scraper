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
        const url = new URL(fandom);
        const hostname = url.hostname;
        const parts = hostname.split('.');
        return parts[0];
    } catch (error) {
        return fandom;
    }
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

async function scrapeFandom(fandom: string): Promise<Page[]> {
    const baseUrl = `https://${fandom}.fandom.com/`;
    let nextPageUrl = '/wiki/Special:AllPages';
    let counter = 0;
    const rawXml = [];

    while (nextPageUrl !== '') {
        let listOfPages = '';
        const currentUrl = new URL(nextPageUrl, baseUrl);
        const fetchResponse = await fetch(currentUrl, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT } });
        const fetchContent = await fetchResponse.text();
        const dom = new JSDOM(fetchContent);
        const content = dom.window.document.querySelector('.mw-allpages-body');
        const nextPage = dom.window.document.querySelector('.mw-allpages-nav');

        if (content) {
            const listOfEntries = content.querySelectorAll('li');
            for (const entry of listOfEntries) {
                if (entry?.textContent) {
                    listOfPages += entry.textContent.replace('(redirect', '') + '\n';
                }
            }
        }

        const payload = new URLSearchParams();
        payload.append('catname', '');
        payload.append('pages', listOfPages);
        payload.append('curonly', '1');
        payload.append('wpDownload', '1');
        payload.append('wpEditToken', '+\\');
        payload.append('title', 'Special:Export');

        console.log(chalk.green(MODULE_NAME), `Scraping ${currentUrl}`);
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
    const parser = new wt2pt.default();
    return parser.parse(wiki);
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
            rawContent = rawContent.replace(/\(\s+/g, '(');
            rawContent = rawContent.replace('()', '').replace('\u00a0', ' ').replace(' , ', ', ');
            rawContent = he.decode(rawContent);

            contentText = rawContent;
        }
        if (titleText && contentText) {
            result.push({ title: titleText, content: contentText });
        }
    }

    return result;
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
            const result = await scrapeFandom(getFandomId(req.body.fandom));
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
