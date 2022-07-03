/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
const axios = require('axios');
const mysql = require('mysql');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const pathToDBUser = 'projects/199194440168/secrets/DB_USER/versions/latest';
const pathToDBPass = 'projects/199194440168/secrets/DB_PASS/versions/latest';
const pathToDBHost = 'projects/199194440168/secrets/DB_HOST/versions/latest';
const pathToDBPort = 'projects/199194440168/secrets/DB_PORT/versions/latest';

const pathToCa = 'projects/199194440168/secrets/DB_CA/versions/latest';
const pathToKey = 'projects/199194440168/secrets/DB_KEY/versions/latest';
const pathToCert = 'projects/199194440168/secrets/DB_CERT/versions/latest';

const client = new SecretManagerServiceClient();

exports.main = async (req, res) => {
	const [dbUser, dbPass, dbHost, dbPort, ca, key, cert] = await Promise.all([
		accessSecretVersion(pathToDBUser),
		accessSecretVersion(pathToDBPass),
		accessSecretVersion(pathToDBHost),
		accessSecretVersion(pathToDBPort),
		accessSecretVersion(pathToCa),
		accessSecretVersion(pathToKey),
		accessSecretVersion(pathToCert),
	]);

	const connection = mysql.createConnection({
		host: dbHost,
		user: dbUser,
		password: dbPass,
		port: dbPort,
		ssl: {
			ca: ca,
			key: key,
			cert: cert,
		},
	});

	connection.connect((error) => {
		if (error) {
			console.log(`Connection Error: ${error}`);
		}
	});
	connection.query(`SHOW DATABASES`, (err, results) => {
		err ? console.log(err) : console.log(JSON.stringify({ results }));
	});
	res.send('OK');
};

async function accessSecretVersion(secretKey) {
	const [version] = await client.accessSecretVersion({
		name: secretKey,
	});
	const payload = version.payload.data.toString();
	return payload;
}
