import express from "express";
import { createClient } from "@libsql/client";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const connection = createClient({
	url: process.env.TURSO_DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN
});

const app = express();
app.use(cors());


app.get("/", (req, res) => {
	res.json({
		message: "Root"
	});
}); 

app.get("/chat", async (req, res) => {
	try {
		const data = await connection.execute("SELECT * FROM chat");

		res.json({
			statusCode: res.statusCode,
			response: data.rows
		});
	} catch (error) {
		res.json({
			statusCode: res.statusCode,
			response: error
		});
	}
});

app.listen(3000);

export default app;