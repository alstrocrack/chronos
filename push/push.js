/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */

const axios = require('axios');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const pathTochannelAccessToken = 'projects/199194440168/secrets/CHANNEL_ACCESS_TOKEN/versions/latest';
const pathToAdminTo = 'projects/199194440168/secrets/ADMIN_TO/versions/latest';

const client = new SecretManagerServiceClient();

exports.push = async (event, context) => {
	const channelAccessToken = await accessSecretVersion(pathTochannelAccessToken);
	const adminTo = await accessSecretVersion(pathToAdminTo);
	push(channelAccessToken, adminTo, 'hello');
};

async function accessSecretVersion(secretKey) {
	const [version] = await client.accessSecretVersion({
		name: secretKey,
	});
	const payload = version.payload.data.toString();
	return payload;
}

async function push(channelAccessToken, to, message = null) {
	await axios({
		method: 'post',
		url: 'https://api.line.me/v2/bot/message/push',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${channelAccessToken}`,
		},
		data: {
			to: to,
			messages: [
				{
					'type': 'text',
					'text': message,
				},
			],
		},
	})
		.then((response) => {
			console.log(response);
		})
		.catch((error) => {
			console.log(error);
		});
}
