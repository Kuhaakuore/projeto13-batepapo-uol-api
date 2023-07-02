import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import Joi from "joi";
import dayjs from "dayjs";
import { stripHtml } from "string-strip-html";

// App creation
const app = express();

// Configs
app.use(cors());
app.use(express.json());
dotenv.config();

// Database connection
const mongoClient = new MongoClient(process.env.DATABASE_URL);

try {
  await mongoClient.connect(); // top level await
  console.log("MongoDB connect!");
} catch (err) {
  (err) => console.log(err.message);
}

const db = mongoClient.db();

// Endpoints
app.post("/participants", async (req, res) => {

  const schemaParticipant = Joi.object({
    name: Joi.string().required(),
  });

  const validation = schemaParticipant.validate(req.body, {
    abortEarly: false,
  });

  if (validation.error) return res.sendStatus(422);

  const name = stripHtml(req.body.name).result.trim();

  try {
    let participant = await db.collection("participants").findOne({ name });
    if (participant) return res.sendStatus(409);

    participant = {
      name,
      lastStatus: Date.now(),
    };
    await db.collection("participants").insertOne(participant);

    const message = {
      from: name,
      to: "Todos",
      text: "entra na sala...",
      type: "status",
      time: dayjs(Date.now()).format("HH:mm:ss"),
    };
    await db.collection("messages").insertOne(message);

    return res.sendStatus(201);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

app.get("/participants", async (req, res) => {
  try {
    const participants = await db.collection("participants").find().toArray();
    return res.send(participants);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

app.post("/messages", async (req, res) => {
  const { user } = req.headers;
  if (user === undefined) return res.sendStatus(422);
  const name = stripHtml(user).result.trim();
  
  try {
    const participant = await db.collection("participants").findOne({ name });
    if (!participant) return res.sendStatus(422);

    const schemaMessage = Joi.object({
      from: Joi.required(),
      to: Joi.string().required(),
      text: Joi.string().required(),
      type: Joi.valid("message", "private_message").required(),
    });

    const validation = schemaMessage.validate(
      { from: user, ...req.body },
      {
        abortEarly: false,
      }
    );

    if (validation.error) return res.sendStatus(422);

    const sanitizedParams = {
      from: name,
      to: stripHtml(req.body.to).result.trim(),
      text: stripHtml(req.body.text).result.trim(),
      type: stripHtml(req.body.type).result.trim(),
    };

    const message = {
      ...sanitizedParams,
      time: dayjs(Date.now()).format("HH:mm:ss"),
    };
    await db.collection("messages").insertOne(message);

    return res.sendStatus(201);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

app.get("/messages", async (req, res) => {
  const { user } = req.headers;
  const name = stripHtml(user).result.trim();
  const limit = req.query.limit;

  try {
    const participant = await db
      .collection("participants")
      .findOne({ name });
    if (!participant) return res.sendStatus(409);

    const messages = await db
      .collection("messages")
      .find({
        $or: [
          { type: "message" },
          { to: "Todos" },
          {
            $and: [
              { type: "private_message" },
              { $or: [{ to: user }, { from: user }] },
            ],
          },
        ],
      })
      .toArray();

    if (limit === undefined) return res.send(messages.reverse());
    const limitValue = parseInt(limit);
    if (limitValue <= 0 || isNaN(limitValue)) return res.sendStatus(422);

    return res.send(messages.slice(-limitValue).reverse());
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

app.post("/status", async (req, res) => {
  const { user } = req.headers;
  if (user === undefined) return res.sendStatus(404);
  const name = stripHtml(user).result.trim();
  try {
    const updatedParticipant = {
      lastStatus: Date.now(),
    };
    const result = await db
      .collection("participants")
      .updateOne({ name }, { $set: updatedParticipant });

    if (result.matchedCount === 0) return res.sendStatus(404);

    return res.sendStatus(200);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

const removeInactiveParticipants = async () => {
  const now = Date.now();
  try {
    const participants = await db
      .collection("participants")
      .find({ lastStatus: { $lt: now - 10000 } })
      .toArray();
    if (participants.length <= 0) return;
    await db
      .collection("participants")
      .deleteMany({ lastStatus: { $lt: now - 10000 } });

    participants.forEach(async (participant) => {
      const message = {
        from: participant.name,
        to: "Todos",
        text: "sai da sala...",
        type: "status",
        time: dayjs(now).format("HH:mm:ss"),
      };
      try {
        await db.collection("messages").insertOne(message);
      } catch (err) {
        console.log(err.message);
      }
    });
  } catch (err) {
    console.log(err.message);
  }
};

setInterval(removeInactiveParticipants, 15000);

app.delete("/messages/:id", async (req, res) => {
  const { id } = req.params;
  const { user } = req.headers;
  const name = stripHtml(user).result.trim();

  try {
    const message = await db
      .collection("messages")
      .findOne({ _id: new ObjectId(id) });
    if (!message) return res.sendStatus(404);
    if (message.from !== name) return res.sendStatus(401);

    await db.collection("messages").deleteOne({ _id: new ObjectId(id) });
    return res.sendStatus(200);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

app.put("/messages/:id", async (req, res) => {
  const { id } = req.params;
  const { user } = req.headers;
  const name = stripHtml(user).result.trim();

  try {
    const participant = await db
      .collection("participants")
      .findOne({ name });
    if (!participant) return res.sendStatus(422);

    const schemaMessage = Joi.object({
      from: Joi.required(),
      to: Joi.string().required(),
      text: Joi.string().required(),
      type: Joi.valid("message", "private_message").required(),
    });

    const validation = schemaMessage.validate(
      { from: name, ...req.body },
      {
        abortEarly: false,
      }
    );

    if (validation.error) return res.sendStatus(422);

    const sanitizedParams = {
      from: name,
      to: stripHtml(req.body.to).result.trim(),
      text: stripHtml(req.body.text).result.trim(),
      type: stripHtml(req.body.type).result.trim(),
    };

    const message = await db
      .collection("messages")
      .findOne({ _id: new ObjectId(id) });
    if (!message) return res.sendStatus(404);
    if (message.from !== user) return res.sendStatus(401);

    await db
      .collection("messages")
      .updateOne({ _id: new ObjectId(id) }, { $set: { ...sanitizedParams } });

    return res.sendStatus(200);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

app.listen(process.env.PORT, () =>
  console.log(`Server is running on port ${process.env.PORT}`)
);
