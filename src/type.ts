import { RowDataPacket } from "mysql2";
import { WebhookRequestBody } from "@line/bot-sdk";

export interface UserStatusData extends RowDataPacket {
	status: number;
}

export interface BirthdayInfomation extends RowDataPacket {
	id: string;
	name: string;
	year: number | null;
	month: number;
	date: number;
}

export interface userCache {
	id: string;
	name: string | null;
	status: number;
}

export interface LambdaEvent {
	method: string;
	body: WebhookRequestBody;
	headers: any;
}
