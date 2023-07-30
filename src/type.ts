import { RowDataPacket } from "mysql2";

export interface UserStatusData extends RowDataPacket {
	status: number;
}
