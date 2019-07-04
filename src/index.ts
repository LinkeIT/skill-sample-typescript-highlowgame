// Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// Licensed under the Amazon Software License
// http://aws.amazon.com/asl/

/* eslint-disable  func-names */
/* eslint-disable  no-console */
/* eslint-disable  no-restricted-syntax */

// tslint:disable-next-line: no-var-requires
const i18n = require("i18next");
import i18next from "i18next";
import * as sprintf from "i18next-sprintf-postprocessor";
import { enData } from "./languages/en";
import { RequestHandler, HandlerInput, ErrorHandler, RequestInterceptor, SkillBuilders } from "ask-sdk";
import { Response, SessionEndedRequest, IntentRequest } from "ask-sdk-model";
import * as ddbAdapter from "ask-sdk-dynamodb-persistence-adapter"; // included in ask-sdk
import { RequestAttributes } from "./interfaces";
import { Strings } from "./languages/Strings";

// TODO: The items below this comment need your attention.
const ddbTableName = "High-Low-Game";

class LaunchRequest implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    // launch requests as well as any new session, as games are not saved in progress, which makes
    // no one shots a reasonable idea except for help, and the welcome message provides some help.
    return (handlerInput.requestEnvelope.session && handlerInput.requestEnvelope.session.new) || handlerInput.requestEnvelope.request.type === "LaunchRequest";
  }
  public async handle(handlerInput: HandlerInput): Promise<Response> {
    const attributesManager = handlerInput.attributesManager;
    const responseBuilder = handlerInput.responseBuilder;

    const attributes = await attributesManager.getPersistentAttributes();
    console.log("getPersistentAttributes");
    console.log(attributes);
    if (Object.keys(attributes).length === 0) {
      attributes.endedSessionCount = 0;
      attributes.gamesPlayed = 0;
      attributes.gameState = "ENDED";
    }

    attributesManager.setSessionAttributes(attributes);

    const requestAttributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;
    const gamesPlayed = attributes.gamesPlayed.toString();
    const speechOutput = requestAttributes.t(Strings.LAUNCH_MESSAGE, gamesPlayed);
    const reprompt = requestAttributes.t(Strings.LAUNCH_REPROMPT);

    return responseBuilder
      .speak(speechOutput)
      .reprompt(reprompt)
      .getResponse();
  }
}

class ExitHandler implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    const request = handlerInput.requestEnvelope.request;

    return request.type === "IntentRequest"
      && (request.intent.name === "AMAZON.CancelIntent"
        || request.intent.name === "AMAZON.StopIntent");
  }
  public handle(handlerInput: HandlerInput): Response {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;
    return handlerInput.responseBuilder
      .speak(requestAttributes.t(Strings.EXIT_MESSAGE))
      .getResponse();
  }
}

class SessionEndedIntentRequest implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "SessionEndedRequest";
  }
  public handle(handlerInput: HandlerInput): Response {
    console.log(`Session ended with reason: ${(handlerInput.requestEnvelope.request as SessionEndedRequest).reason}`);
    return handlerInput.responseBuilder.getResponse();
  }
}

class HelpIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    const request = handlerInput.requestEnvelope.request;

    return request.type === "IntentRequest" && request.intent.name === "AMAZON.HelpIntent";
  }
  public handle(handlerInput: HandlerInput): Response {
    const speechOutput = "I am thinking of a number between zero and one hundred, try to guess it and I will tell you" +
      " if it is higher or lower.";
    const reprompt = "Try saying a number.";
    return handlerInput.responseBuilder
      .speak(speechOutput)
      .reprompt(reprompt)
      .getResponse();
  }
}

class YesIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    // only start a new game if yes is said when not playing a game.
    let isCurrentlyPlaying = false;
    const request = handlerInput.requestEnvelope.request;
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (sessionAttributes.gameState &&
      sessionAttributes.gameState === "STARTED") {
      isCurrentlyPlaying = true;
    }

    return !isCurrentlyPlaying && request.type === "IntentRequest" && request.intent.name === "AMAZON.YesIntent";
  }
  public handle(handlerInput: HandlerInput): Response {
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;

    sessionAttributes.gameState = "STARTED";
    sessionAttributes.guessNumber = Math.floor(Math.random() * 101);

    attributesManager.setSessionAttributes(sessionAttributes);

    return handlerInput.responseBuilder
      .speak(requestAttributes.t(Strings.YES_MESSAGE))
      .reprompt(requestAttributes.t(Strings.HELP_REPROMPT))
      .getResponse();
  }
}

class NoIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    // only treat no as an exit when outside a game
    let isCurrentlyPlaying = false;
    const request = handlerInput.requestEnvelope.request;
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (sessionAttributes.gameState &&
      sessionAttributes.gameState === "STARTED") {
      isCurrentlyPlaying = true;
    }

    return !isCurrentlyPlaying && request.type === "IntentRequest" && request.intent.name === "AMAZON.NoIntent";
  }
  public async handle(handlerInput: HandlerInput): Promise<Response> {
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;

    sessionAttributes.endedSessionCount += 1;
    sessionAttributes.gameState = "ENDED";
    attributesManager.setPersistentAttributes(sessionAttributes);

    await attributesManager.savePersistentAttributes();

    return handlerInput.responseBuilder
      .speak(requestAttributes.t(Strings.STOP_MESSAGE))
      .getResponse();

  }
}

class UnhandledIntent implements RequestHandler {
  public canHandle() {
    return true;
  }
  public handle(handlerInput: HandlerInput): Response {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;

    return handlerInput.responseBuilder
      .speak(requestAttributes.t(Strings.UNHANDLED_RESPONSE))
      .reprompt(requestAttributes.t(Strings.UNHANDLED_RESPONSE))
      .getResponse();
  }
}

class NumberGuessIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    // handle numbers only during a game
    let isCurrentlyPlaying = false;
    const request = handlerInput.requestEnvelope.request;
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (sessionAttributes.gameState &&
      sessionAttributes.gameState === "STARTED") {
      isCurrentlyPlaying = true;
    }

    return isCurrentlyPlaying && request.type === "IntentRequest" && request.intent.name === "NumberGuessIntent";
  }
  public async handle(handlerInput: HandlerInput): Promise<Response> {
    const { requestEnvelope, attributesManager } = handlerInput;
    const { intent } = requestEnvelope.request as IntentRequest;

    const guessNum = parseInt(intent.slots!.number.value!, 10);
    const sessionAttributes = attributesManager.getSessionAttributes();
    const targetNum = sessionAttributes.guessNumber;
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;

    if (guessNum > targetNum) {
      return handlerInput.responseBuilder
        .speak(requestAttributes.t(Strings.TOO_HIGH_MESSAGE, guessNum.toString()))
        .reprompt(requestAttributes.t(Strings.TOO_HIGH_REPROMPT))
        .getResponse();
    } else if (guessNum < targetNum) {
      return handlerInput.responseBuilder
        .speak(requestAttributes.t(Strings.TOO_LOW_MESSAGE, guessNum.toString()))
        .reprompt(requestAttributes.t(Strings.TOO_LOW_REPROMPT))
        .getResponse();
    } else if (guessNum === targetNum) {
      sessionAttributes.gamesPlayed += 1;
      sessionAttributes.gameState = "ENDED";
      attributesManager.setPersistentAttributes(sessionAttributes);
      await attributesManager.savePersistentAttributes();
      return handlerInput.responseBuilder
        .speak(requestAttributes.t(Strings.GUESS_CORRECT_MESSAGE, guessNum.toString()))
        .reprompt(requestAttributes.t(Strings.GUESS_CORRECT_REPROMPT))
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak(requestAttributes.t(Strings.FALLBACK_MESSAGE_DURING_GAME, requestAttributes.t(Strings.SKILL_NAME)))
      .reprompt(requestAttributes.t(Strings.FALLBACK_REPROMPT_DURING_GAME))
      .getResponse();
  }
}

class CustomErrorHandler implements ErrorHandler {
  public canHandle() {
    return true;
  }
  public handle(handlerInput: HandlerInput, error: Error): Response {
    console.log(`Error handled: ${error.message}`);
    console.log(`Error stack: ${error.stack}`);
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;
    return handlerInput.responseBuilder
      .speak(requestAttributes.t(Strings.ERROR_MESSAGE))
      .reprompt(requestAttributes.t(Strings.ERROR_MESSAGE))
      .getResponse();
  }
}

class FallbackHandler implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    // handle fallback intent, yes and no when playing a game
    // for yes and no, will only get here if and not caught by the normal intent handler
    const request = handlerInput.requestEnvelope.request;
    return request.type === "IntentRequest" &&
      (request.intent.name === "AMAZON.FallbackIntent" ||
        request.intent.name === "AMAZON.YesIntent" ||
        request.intent.name === "AMAZON.NoIntent");
  }
  public handle(handlerInput: HandlerInput): Response {
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;

    if (sessionAttributes.gameState &&
      sessionAttributes.gameState === "STARTED") {
      // currently playing
      return handlerInput.responseBuilder
        .speak(requestAttributes.t(Strings.FALLBACK_MESSAGE_DURING_GAME, requestAttributes.t(Strings.SKILL_NAME)))
        .reprompt(requestAttributes.t(Strings.FALLBACK_REPROMPT_DURING_GAME))
        .getResponse();
    }

    // not playing
    return handlerInput.responseBuilder
      .speak(requestAttributes.t(Strings.FALLBACK_MESSAGE_OUTSIDE_GAME, requestAttributes.t(Strings.SKILL_NAME)))
      .reprompt(requestAttributes.t(Strings.FALLBACK_REPROMPT_OUTSIDE_GAME))
      .getResponse();
  }
}

// getRandomItem
export function getRandomItem<T>(arrayOfItems: T[]) {
  // the argument is an array [] of words or phrases
  const i = Math.floor(Math.random() * arrayOfItems.length);
  return (arrayOfItems[i]);
}

type TranslationFunction = (...args: any[]) => string;

const languageStrings: i18next.Resource = {
  en: enData,
};

/**
 * Adds translation functions to the RequestAttributes.
 */
export class LocalizationInterceptor implements RequestInterceptor {
  public async process(handlerInput: HandlerInput): Promise<void> {
    const t = await i18n.use(sprintf).init({
      lng: handlerInput.requestEnvelope.request.locale,
      overloadTranslationOptionHandler:
        sprintf.overloadTranslationOptionHandler,
      resources: languageStrings,
      returnObjects: true,
    });

    const attributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;
    attributes.t = (...args: any[]) => {
      return (t as TranslationFunction)(...args);
    };
    attributes.tr = (key: any) => {
      const result = t(key) as string[];
      return getRandomItem(result);
    };
  }
}

function getPersistenceAdapter(tableName: string) {
  // Determines persistence adapter to be used based on environment
  // Note: tableName is only used for DynamoDB Persistence Adapter
  if (process.env.S3_PERSISTENCE_BUCKET) {
    // in Alexa Hosted Environment
    // eslint-disable-next-line global-require
    const s3Adapter = require("ask-sdk-s3-persistence-adapter");
    return new s3Adapter.S3PersistenceAdapter({
      bucketName: process.env.S3_PERSISTENCE_BUCKET,
    });
  }

  // Not in Alexa Hosted Environment
  return new ddbAdapter.DynamoDbPersistenceAdapter({
    tableName,
    createTable: true,
  });
}

const skillBuilder = SkillBuilders.custom();

exports.handler = skillBuilder
  .withPersistenceAdapter(getPersistenceAdapter(ddbTableName))
  .addRequestHandlers(
    new LaunchRequest(),
    new ExitHandler(),
    new SessionEndedIntentRequest(),
    new HelpIntent(),
    new YesIntent(),
    new NoIntent(),
    new NumberGuessIntent(),
    new FallbackHandler(),
    new UnhandledIntent(),
  )
  .addRequestInterceptors(new LocalizationInterceptor())
  .addErrorHandlers(new CustomErrorHandler())
  .lambda();
