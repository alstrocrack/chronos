/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
const axios = require('axios');

exports.main = (req, res) => {
	let message = req.query.message || req.body.message || 'Hello World!';
	res.status(200).send(message);
	reply(req.body.events[0].replyToken);
};

// async function reply(replyToken, message = null) {
// 	await axios
// 		.post('https://api.line.me/v2/bot/message/reply', {
// 			headers: {
// 				'Content-Type': 'application/json',
// 				'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}`,
// 			},
// 			data: {
// 				replyToken: replyToken,
// 				messages: [
// 					{
// 						'type': 'text',
// 						'text': message,
// 					},
// 				],
// 			},
// 		})
// 		.then((response) => {
// 			console.log(response);
// 		})
// 		.catch((error) => {});
// }
