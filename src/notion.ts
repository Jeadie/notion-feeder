import dotenv from 'dotenv';
import { Client as NotionClient, isNotionClientError, LogLevel } from '@notionhq/client';
import { QueryDatabaseResponse } from '@notionhq/client/build/src/api-endpoints';

dotenv.config();

interface NotionConfig {
  token: string,
  readerDatabaseId: string,
  feedDatabaseId: string,
  logLevel: LogLevel,
}

const notionConfig = createNotionConfig(process.env)

function createNotionConfig(nodeConfig: NodeJS.ProcessEnv): NotionConfig {
  if (nodeConfig.NOTION_API_TOKEN == undefined) {
    throw new Error("Environment variable `NOTION_API_TOKEN` is required but not set.")
  } else if (nodeConfig.NOTION_READER_DATABASE_ID == undefined) {
    throw new Error("Environment variable `NOTION_READER_DATABASE_ID` is required but not set.")
  } else if (nodeConfig.NOTION_FEEDS_DATABASE_ID == undefined) {
    throw new Error("Environment variable `NOTION_FEEDS_DATABASE_ID` is required but not set.")
  }
  return {
    token: nodeConfig.NOTION_API_TOKEN,
    readerDatabaseId: nodeConfig.NOTION_READER_DATABASE_ID,
    feedDatabaseId: nodeConfig.NOTION_FEEDS_DATABASE_ID,
    logLevel: process.env.CI ? LogLevel.INFO : LogLevel.DEBUG
  }
}

interface RssFeed {
  title: string,
  url: string,
}

interface FeedItem {
  title: string,
  link: string,

  // See BlockObjectRequest from '@notionhq/client/build/src/api-endpoints';
  content: any[],
}


class NotionWrapper {
  private client: NotionClient;
  private config: NotionConfig;

  constructor(config: NotionConfig) {
    this.config = config
    this.client = new NotionClient({
      auth: config.token,
      logLevel: config.logLevel,
    });
  }

  handleNotionError(e: Error) {
    if (isNotionClientError(e)) {
      // Update error catching https://github.com/makenotion/notion-sdk-js#typescript
      console.log(e.code)
    } else {
      // Other error handling code
      console.error(e)
    }
  }

  async getEnabledRssFeeds(): Promise<RssFeed[]>  {
    return this.client.databases.query({
      database_id: this.config.feedDatabaseId,
      filter: {
        or: [
          {
            property: 'Enabled',
            checkbox: {
              equals: true,
            },
          },
        ],
      },
    }).then((response) => {
      return response.results.map((x) => ({
        title: (x.properties["Title"] as any).title[0].plain_text,
        url: (x.properties["Link"] as any).url,
      }))
    }).catch(onrejected => {
      this.handleNotionError(onrejected as Error)
      return [];
    });
  }

  async addFeedItem(item: FeedItem) {
    const { title, link, content } = item;
    this.client.pages.create({
        parent: {
          database_id: this.config.feedDatabaseId,
        },
        properties: {
          Title: {
            title: [
              {
                text: {
                  content: title,
                },
              },
            ],
          },
          Link: {
            url: link,
          },
        },
        children: content,
      }).catch ((err: any) => {
      this.handleNotionError(err);
    })
  }

  archiveUnreadFeedItems() {
    this.getOldUnreadFeedItemIds(30).then((pageIds: string[]) => {
      this.archivePages(pageIds)
    })
  }

  async getOldUnreadFeedItemIds(inLastNdays: number): Promise<string[]> {
    const fetchBeforeDate = new Date();
    fetchBeforeDate.setDate(fetchBeforeDate.getDate() - inLastNdays);
    return this.client.databases.query({
      database_id: this.config.feedDatabaseId,
      filter: {
        and: [
          {
            property: 'Created At',
            date: {
              on_or_before: fetchBeforeDate.toJSON(),
            },
          },
          {
            property: 'Read',
            checkbox: {
              equals: false,
            },
          },
        ],
      },
    }).then((response: QueryDatabaseResponse) => {
      return response.results.map((item) => item.id)
    })
    .catch((err: any) => {
      this.handleNotionError(err)
      return [];
    })
  }

  archivePages(pageIds: string[]) {
    pageIds.forEach((id) => {
      this.client.pages.update({page_id: id, archived: true});
    })
  }
}

export default new NotionWrapper(notionConfig);