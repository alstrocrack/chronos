import { RowDataPacket } from "mysql2";

export interface UserStatusData extends RowDataPacket {
	status: number;
}

export interface BirthdayInfomation extends RowDataPacket {
	name: string;
	userAccountId: string;
	year: number | null;
	month: number;
	date: number;
}

export interface userCache {
	id: string;
	name: string | null;
	status: number;
}
