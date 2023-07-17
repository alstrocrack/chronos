import * as line from '@line/bot-sdk';
import { WebhookRequestBody, FollowEvent, Message, Client } from '@line/bot-sdk';
import * as mysql from 'mysql2';
import { ConnectionOptions, ResultSetHeader, Connection } from 'mysql2';

const lineConfig = {
	channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
	channelSecret: process.env.CHANNEL_SECRET!,
};

const dbConfig: ConnectionOptions = {
	host: process.env.DB_HOST!,
	user: process.env.DB_USER!,
	password: process.env.DB_PASSWORD!,
	database: process.env.DB_NAME!,
	port: Number(process.env.DB_PORT!),
};

export const handler = async (event: WebhookRequestBody, context: any) => {
	const lineClient = new line.Client(lineConfig);
	const db = mysql.createConnection(dbConfig);

	const events: Array<any> = event.events;

	events.forEach((event) => {
		const eventType: string = event.type;

		switch (eventType) {
			case 'follow':
				registerEvent(lineClient, event, db);
				break;
		}
	});
};

const registerEvent = async (client: Client, event: FollowEvent, db: Connection) => {
	const userInsertQuery = `
		INSERT INTO user_accounts (id, created_at, updated_at) VALUES (?, Now(), Now());
	`;
	if (!event.source.userId) {
		throw new Error('FOLLOW: Invalid user token');
	}
	const userId: string = event.source.userId;

	db.query<ResultSetHeader>(userInsertQuery, userId, (err, _rows) => {
		if (err) {
			throw new Error('HERE DB ERROR!!');
		}
	});
	const message: Message = {
		type: 'text',
		text: 'Birthday Reminderを登録ありがとうございます！',
	};
	await client.replyMessage(event.replyToken, message);
};
