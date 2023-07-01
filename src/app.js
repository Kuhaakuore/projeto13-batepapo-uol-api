import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import Joi from "joi";
import dayjs from "dayjs";

// App creation
const app = express();

// Configurations
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
  const { name } = req.body;

  const schemaParticipant = Joi.object({
    name: Joi.string().required(),
  });

  const validation = schemaParticipant.validate(req.body, {
    abortEarly: false,
  });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    let participant = await db.collection("participants").findOne({ name });
    if (participant) return res.status(409).send("Participant already exist!");

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

    res.sendStatus(201);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/participants", async (req, res) => {
  try {
    const participants = await db.collection("participants").find().toArray();
    res.send(participants);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/messages", async (req, res) => {
  const { user } = req.headers;
  const participant = await db
    .collection("participants")
    .findOne({ name: user });
  if (!participant) return res.status(409).send("Participant do not exist!");

  const schemaMessage = Joi.object({
    to: Joi.string().required(),
    text: Joi.string().required(),
    type: Joi.allow("message", "private_message"),
    from: Joi.required(),
  });

  const validation = schemaMessage.validate(
    { ...req.body, from: user },
    {
      abortEarly: false,
    }
  );

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    const message = {
      from: user,
      ...req.body,
      time: dayjs(Date.now()).format("HH:mm:ss"),
    };
    await db.collection("messages").insertOne(message);

    res.sendStatus(201);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/messages", async (req, res) => {
  const { user } = req.headers;
  const limit  = parseInt(req.query.limit);

  try {
    const participant = await db
      .collection("participants")
      .findOne({ name: user });
    if (!participant) return res.status(409).send("Participant do not exist!");

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
    if (limit === undefined) return res.send(messages);
    if (limit <= 0 || typeof limit !== "number") return res.sendStatus(422);
    
    res.send(messages.slice(-limit).reverse());
  } catch (err) {
    res.status(500).send(err.message);
  }

  try {
    const receita = await db
      .collection("receitas")
      .findOne({ _id: new ObjectId(id) });
    res.send(receita);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete("/receitas/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db
      .collection("receitas")
      .deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0)
      return res.status(404).send("Essa receita não existe!");

    res.status(204).send("Receita deletada com sucesso!");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete("/receitas/muitas/:filtroIngredientes", async (req, res) => {
  const { filtroIngredientes } = req.params;

  try {
    await db
      .collection("receitas")
      .deleteMany({ ingredientes: filtroIngredientes });
    res.sendStatus(204);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/receitas/:id", async (req, res) => {
  const { id } = req.params;
  const { titulo, preparo, ingredientes } = req.body;

  try {
    // result tem:  matchedCount  (quantidade de itens que encotrou com esse id)
    // 				modifiedCount (quantidade de itens que de fato mudaram com a edição)
    const result = await db
      .collection("receitas")
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { titulo, preparo, ingredientes } }
      );
    if (result.matchedCount === 0)
      return res.status(404).send("esse item não existe!");
    res.send("Receita atualizada!");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/receitas/muitas/:filtroIngredientes", async (req, res) => {
  const { filtroIngredientes } = req.params;
  const { titulo, ingredientes, preparo } = req.body;

  try {
    await db
      .collection("receitas")
      .updateMany(
        { ingredientes: { $regex: filtroIngredientes, $options: "i" } },
        { $set: { titulo } }
      );
    res.sendStatus(200);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

app.listen(process.env.PORT, () =>
  console.log(`Server is running on port ${process.env.PORT}`)
);
