import * as line from "@line/bot-sdk";
import { WebhookRequestBody, FollowEvent, Message, MessageEvent, MessageAPIResponseBase } from "@line/bot-sdk";
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

interface UserStatusData extends RowDataPacket {
	status: number;
}

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
			eventResult = await replyEvent(event);
			break;
		default:
			eventResult = false;
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

	const status: number = await getUsersStatus(userId);

	try {
		switch (status) {
			case userStatus.no:
				switch (eventType) {
					case chronosEventType.add:
						await reply("名前と誕生日を入力してください", replyToken);
						await changeUserStatus(userStatus.add, userId);
					case chronosEventType.list:
						const birthdays = await getUsersBirthdays(userId);
						await reply(birthdays, replyToken);
					case chronosEventType.delete:
						await changeUserStatus(userStatus.delete, userId);
						await reply("名前を入力してください", replyToken);
					default:
						console.log("reach default");
						break;
				}
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
		UPDATE user_accounts SET status = ? WHERE id = ?;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [resultSetHeader, _fieldPacket] = await connect.execute<ResultSetHeader>(userUpdateQuery, [updatingStatus, userId]);
	return resultSetHeader.affectedRows == 1 ? true : false;
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

const getUsersStatus = async (userId: string) => {
	const userStatusQuery = `
		SELECT status FROM user_accounts WHERE id = ?;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [status] = await connect.query<UserStatusData[]>(userStatusQuery, [userId]);
	return status[0].status;
};

// general
const reply = async (text: string, replyToken: string) => {
	const client = new line.Client(lineConfig);
	const message: Message = {
		type: "text",
		text: text,
	};
	return await client.replyMessage(replyToken, message);
};
