import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as cryptoJS from "crypto-js";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

// interface User {
//   token: string;
//   last_request: Date;
//   rate_limit_left: Number;
// }

export const helloWorld = onRequest(
  { cors: true },
  async (request, response) => {
    let stream = false;
    if (
      request.query.hasOwnProperty("stream") &&
      request.query["stream"] == "true"
    ) {
      stream = true;
    }

    const authHeader = request.headers["authorization"];
    if (!authHeader) {
      response.status(401).send("Unauthorized");
      return;
    }
    const token = authHeader.split(" ")[1];
    const pattern = /^USER\d{3}$/;
    if (!pattern.test(token)) {
      response.status(401).send("Unauthorized");
      return;
    }

    logger.info("Auth token " + token, { structuredData: true });
    let visit_count = 1;
    let rate_limit_left = 4;
    try {
      const docRef = await db.collection("users").doc(token);
      const doc = await docRef.get();
      if (!doc.exists) {
        await db.collection("users").doc(token).set({
          token: token,
          visit_count: visit_count,
          last_request_date: new Date(),
          rate_limit_left: rate_limit_left,
        });
      } else {
        debugger;
        const data = doc.data();
        visit_count = data?.visit_count + 1;
        rate_limit_left = data?.rate_limit_left - 1;
        const last_request_date = data?.last_request_date;
        const differenceSec = Date.now() / 1000 - last_request_date.seconds;

        if (differenceSec > 60) {
          rate_limit_left = 4;
        }

        if (rate_limit_left <= 0) {
          response
            .status(429)
            .send(
              `Rate Limit Exceeded. Try again after ${
                60 - parseInt(differenceSec.toFixed(0), 10)
              } seconds.`
            );
          return;
        }
        await docRef.update({
          visit_count: visit_count,
          last_request_date: new Date(),
          rate_limit_left: rate_limit_left,
        });
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Internal Server Error");
      return;
    }

    let payload = {
      message: `Welcome ${token}, you've visited #${visit_count} ${
        visit_count > 1 ? "times" : "time"
      }.`,
      group: calculateGroup(token),
      rate_limit_left: rate_limit_left,
      stream_seq: stream ? 1 : 0,
    };

    if (stream) {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      });

      var interval = setInterval(() => {
        response.write(JSON.stringify(payload));
        payload.stream_seq += 1;
      }, 1000);
      setTimeout(() => {
        clearInterval(interval);
        response.end();
      }, 5000);
    } else {
      response.send(payload);
    }
  }
);

const calculateGroup = (token: string) => {
  let hash = cryptoJS.SHA256(token).toString();
  let group = (parseInt(hash, 16) % 10) + 1;
  return group;
};
