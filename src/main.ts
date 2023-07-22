import * as line from "@line/bot-sdk";
import { WebhookRequestBody, FollowEvent, Message, MessageEvent } from "@line/bot-sdk";
import mysql from "mysql2/promise";
import { ConnectionOptions, ResultSetHeader, RowDataPacket } from "mysql2";

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

const chronosEventType = {
	add: "誕生日の追加",
	list: "誕生日の一覧",
	delete: "誕生日の削除",
};

const userStatus = {
	no: 0,
	add: 1,
	delete: 2,
};

// handler
export const handler = async (event: WebhookRequestBody, _context: any, callback: any) => {
	const events: Array<any> = event.events;

	const results = await Promise.all(
		events.map(async (event) => {
			return await handleEachEvent(event);
		}),
	);

	const isFail = results.includes(false);

	const response = isFail
		? {
				statusCode: "400",
				body: JSON.stringify({ error: "Bad Request" }),
				headers: {
					"Content-Type": "application/json",
				},
		  }
		: {
				statusCode: "200",
				headers: {
					"Content-Type": "application/json",
				},
		  };

	callback(null, response);
};

const handleEachEvent = async (event: any) => {
	const eventType: string = event.type;
	let eventResult: boolean = true;

	switch (eventType) {
		case "follow":
			eventResult = await registerEvent(event);
			break;
		case "message":
			replyEvent(event);
			break;
	}
	return eventResult;
};

// event handler
const registerEvent = async (event: FollowEvent) => {
	if (!event.source.userId) {
		throw new Error("FOLLOW: Invalid user token");
	}
	let result: boolean = true;
	const userId: string = event.source.userId;
	await registerNewUser(userId)
		.then((res) => {
			console.log(res);
		})
		.catch((res) => {
			result = false;
		});
	await reply("Birthday Reminderを登録ありがとうございます！", event.replyToken)
		.then((res) => {
			console.log(res);
		})
		.catch((res) => {
			result = false;
		});
	return result;
};

const replyEvent = async (event: MessageEvent) => {
	const userId = event.source.userId;
	if (!userId) {
		throw new Error("user_id not found");
	}
	const eventType = event.message.type == "text" ? event.message.text : null;
	const replyToken = event.replyToken;
	let isSuccess: boolean = true;

	try {
		switch (eventType) {
			case chronosEventType.add:
				await changeUserStatus(userStatus.add, userId);
				await reply("名前と誕生日を入力してください", replyToken);
			case chronosEventType.list:
				const birthdays = await getUsersBirthdays(userId);
				await reply(birthdays, replyToken);
			default:
				console.log("reach default");
				break;
		}
	} catch (error) {
		console.log(error);
		isSuccess = false;
	}

	return isSuccess;
};

// DB connetion
const registerNewUser = async (userId: string) => {
	const userInsertQuery = `
		INSERT INTO user_accounts (user_id, created_at, updated_at) VALUES (?, Now(), Now());
	`;
	const connect = await mysql.createConnection(dbConfig);
	return await connect.query<ResultSetHeader>(userInsertQuery, [userId]);
};

const changeUserStatus = async (updatingStatus: number, userId: string) => {
	const userUpdateQuery = `
		UPDATE user_accounts SET status = ? WHERE user_id = ?;
	`;
	const connect = await mysql.createConnection(dbConfig);
	return await connect.query<ResultSetHeader>(userUpdateQuery, [updatingStatus, userId]);
};

const getUsersBirthdays = async (userId: string) => {
	const userBirthdaysQuery = `
		SELECT * SET status = ? WHERE user_id = ?;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [rawData, _fieldPacket] = await connect.execute<RowDataPacket[]>(userBirthdaysQuery, [userId]);
	let usersBirthdays: string = "誕生日の一覧\n";
	rawData.forEach((birthday) => {
		usersBirthdays += `${birthday.name} ${birthday.month + birthday.date} ${22}歳\n`;
	});
	return usersBirthdays;
};

// general
const reply = async (text: string, replyToken: string) => {
	const lineClient = new line.Client(lineConfig);
	const message: Message = {
		type: "text",
		text: text,
	};
	await lineClient
		.replyMessage(replyToken, message)
		.then((res) => {
			console.log(res);
		})
		.catch((res) => {
			console.log(res);
		});
};
