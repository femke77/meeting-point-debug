import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { ApolloServer, ExpressContext } from 'apollo-server-express';
import typeDefs  from './schemas/typeDefs.js';
import resolvers from './schemas/resolvers.js';
import { authenticateToken } from './utils/auth.js';
import db from './config/connection.js';
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { PubSub } from 'graphql-subscriptions';
import cors from 'cors';
dotenv.config();

const pubsub:PubSub = new PubSub();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3001;
const app = express();
const httpServer = createServer(app);

console.log("process.env.NODE_ENV", process.env.NODE_ENV);

const schema = makeExecutableSchema({ typeDefs, resolvers });

const server = new ApolloServer({
  schema,
  context:  async ({ req }: { req: express.Request }) => {
    const contextReq = authenticateToken({ req });
    return { user: contextReq.user, pubsub};
  },
});

const startApolloServer = async () => {
  await server.start();
  await db;
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cors({
    origin: 'https://meeting-point-debug.onrender.com', 
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'OPTIONS']
  }));
  app.options('*', (_req, res) => {
    res.header('Access-Control-Allow-Origin', 'https://mingle-point-debug.onrender.com');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(200);
  });

  server.applyMiddleware({ app: app as unknown as ExpressContext['req']['app'], path: '/graphql' });

  // if we're in production, serve client/dist as static assets so everything works off one port,
  // no more dev server on client.
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "../../client/dist")));

    // necessary for client-side routing to work
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "../../client/dist/index.html"));
    });
  }
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });
  
  useServer({ schema,
    context: async (ctx) => {
      const { connectionParams } = ctx;
      console.log("context hit");
      if (connectionParams && connectionParams.Authorization) {
        const token = (connectionParams.Authorization as string).replace("Bearer ", "").trim();
        console.log("server token",token);
        
        try {
          const { data }: any = jwt.verify(token,  process.env.JWT_SECRET_KEY || "MySecret", {
            maxAge: "2hr",
          });
          return { user: data, pubsub };
        } catch (err) {
          console.log("Invalid token for subscription:", err);
        }
      }
      return { pubsub };
    },
  }, wsServer)

  httpServer.listen({ port: PORT }, () => {
    console.log(`Server is now running`);
  });
};

startApolloServer();