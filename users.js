import { connect } from "@tursodatabase/serverless";

const connection = connect({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

exports.handler = async (event, context) => {
    if (event.httpMethod === 'GET') {
        try {
            const stmt = await connection.prepare("SELECT * FROM users");
            const rows = await stmt.all();
            
            return {
                statusCode: 200,
                body: JSON.stringify(rows)
            };
        } catch (error) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error }),
            };
        }
    }
}