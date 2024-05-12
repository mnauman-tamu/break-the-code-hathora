import { Methods, Context } from "./.hathora/methods";
import { Response } from "../api/base";
import {
  Color,
  NumberCard,
  QuestionCard,
  Chat,
  PlayerState,
  UserId,
  IInitializeRequest,
  IJoinGameRequest,
  IStartGameRequest,
  IPickQuestionRequest,
  IGuessRequest,
  IAnswerRequest,
} from "../api/types";

type InternalState = {
  questionDeck: QuestionCard[];
  numberDeck: NumberCard[];
  hands: {userId: UserId, numberCards: NumberCard[] }[];
  turnIdx: number;
  currQuestions?: QuestionCard[];
  chats: Chat[];
  winner?: UserId;
  guessOnly: boolean;
  startingPlayer?: UserId;
};

export class Impl implements Methods<InternalState> {
  initialize(ctx: Context, request: IInitializeRequest): InternalState {
    // create the initial version of our state
    const numberDeck = []; 
    for (let i = 0; i <=9; i++) {
      numberDeck.push({value: i, color: i == 5 ? Color.GREEN : Color.BLACK });
      numberDeck.push({value: i, color: i == 5 ? Color.GREEN : Color.WHITE});
    }

    // TODO: Add validation such that the person asking must provide a number (ids: 6,16,18,19)
    const questionDeck = [
      { id: 1, text: "How many odd tiles do you have?"},
      { id: 2, text: "Which neighboring tiles have consecutive numbers?"},
      { id: 3, text: "How many of your tiles have the same number?"},
      { id: 4, text: "What is the sum of your three left-most tiles?"},
      { id: 5, text: "What is the sum of your three right-most tiles?"},
      { id: 6, text: "Where are your #8 or #9 tiles? You must choose one number before asking that question."},
      { id: 7, text: "Is your C tile greater than 4?"},
      { id: 8, text: "How many of your tiles have a black number?"},
      { id: 9, text: "How many of your tiles have a white number?"},
      { id: 10, text: "What is the sum of your central tiles (b, c and d)?"}, // TODO: change later when 4player is implemented
      { id: 11, text: "What is the sum of your tiles?"},
      { id: 12, text: "How many even tiles do you have? 0 is considered an even number"},
      { id: 13, text: "Where are your #5 tiles?"},
      { id: 14, text: "What is the difference between your highest and lowest number?"},
      { id: 15, text: "Which neighboring tiles have the same color?"},
      { id: 16, text: "Where are your #3 or #4 tiles? You must choose one number before asking that question."},
      { id: 17, text: "What is the sum of your black numbers?"},
      { id: 18, text: "Where are your #6 or #7 tiles? You must choose one number before asking that question."},
      { id: 19, text: "Where are your #1 or #2 tiles? You must choose one number before asking that question."},
      { id: 20, text: "Where are your #0 tiles?"},
      { id: 21, text: "What is the sum of your white numbers?"}
    ];
    const rules: Chat = {text: `Rules: https://boardgame.bg/break%20the%20code%20rules.pdf`, sentAt: ctx.time}; 
    return { questionDeck, numberDeck, hands: [], turnIdx: 0, chats: [rules], guessOnly: false };
  }

  joinGame(state: InternalState, userId: UserId, ctx: Context, request: IJoinGameRequest): Response {
    // append the user who called the method
    state.hands.unshift({ userId, numberCards: [] });
    return Response.ok();
  }

  startGame(state: InternalState, userId: UserId, ctx: Context, request: IStartGameRequest): Response {
    // shuffle the player order and decks
    state.hands = ctx.chance.shuffle(state.hands);
    state.questionDeck = ctx.chance.shuffle(state.questionDeck);
    state.numberDeck = ctx.chance.shuffle(state.numberDeck);
    // give each player 5 number cards
    state.hands.forEach((hand) => {
      for (let i = 0; i < 5; i++) {
        hand.numberCards.push(state.numberDeck.pop()!);
      }
    });
    // Sort each player's cards
    state.hands.forEach((hand) => {
      hand.numberCards.sort((a, b) => {
        if (a.value !== b.value) {
          return a.value - b.value;
        }
        return a.color.toString().localeCompare(b.color.toString());
      });
    });
    // initialize the initial question cards
    state.currQuestions = [];
    for (let i = 0; i < 6; i++) {
      state.currQuestions.push(state.questionDeck.pop()!);
    }
    // Keep track of starting player to determine win conditions
    state.startingPlayer = userId;
    return Response.ok();
  }

  pickQuestion(state: InternalState, userId: UserId, ctx: Context, request: IPickQuestionRequest): Response {
    if (state.guessOnly) {
      return Response.error("You must guess to have a chance at winning!");
    }
    const questionCards = state.currQuestions ?? [];
    const cardIdx = questionCards.findIndex((card: QuestionCard) => card.id == request.card.id);
    // TODO?: change implementation maybe
    if (cardIdx < 0) {
      return Response.error("Invalid question Card index");
    }
    const hand = state.hands[state.turnIdx];
    if (hand.userId !== userId) {
      return Response.error("Not your turn");
    }
    const extraInfo = request.card.text ? ' (' + request.card.text + ')' : '';
    // log the question
    state.chats.unshift({ text: userId + " asked: " + questionCards[cardIdx].text + extraInfo, sentAt: ctx.time});
    // remove from hand
    state.currQuestions?.splice(cardIdx, 1);
    // update pile if applicable
    if (state.questionDeck.length > 0) { 
      state.currQuestions?.push(state.questionDeck.pop()!);
    } else {
      state.chats.unshift({ text: "Out of questions, both players must guess", sentAt: ctx.time});
      state.guessOnly = true;
    }
    // update turn
    state.turnIdx = (state.turnIdx + 1) % state.hands.length;
    return Response.ok();
  }

  guess(state: InternalState, userId: UserId, ctx: Context, request: IGuessRequest): Response {
    // TODO: see if we can somehow initialize it to 5 slots when guessing
    if (request.guess.length !== 5) {
      return Response.error("Must pick 5 cards");
    }
    const hand = state.hands[state.turnIdx];
    if (hand.userId !== userId) {
      return Response.error("Not your turn");
    }
    // TODO: simplify this to automatically pick the other player's id
    if (state.hands.find((hand) => hand.userId === request.user.id) == undefined) {
      return Response.error("Please enter valid userId");
    }
    const guessCards = request.guess;
    const otherUserCards = state.hands.find((hand) => hand.userId === request.user.id)?.numberCards;
    // TODO: is it possible to simplify this if else blurb
    if (JSON.stringify(guessCards) == JSON.stringify(otherUserCards)) {
      if (userId == state.startingPlayer) {
        if (state.guessOnly) {
          state.chats.unshift({ text: userId + " guessed correctly and game is tied.", sentAt: ctx.time});
          // TODO: How to end game?
        } else {
          state.chats.unshift({ text: userId + " guessed correctly and now " + request.user.id + " must guess to tie.", sentAt: ctx.time});
          state.guessOnly = true;
        }
      } else {
        state.chats.unshift({ text: userId + " guessed correctly and won!", sentAt: ctx.time});
        state.winner = userId;
        // TODO: How to end game?
      }
    } else {
      if (state.guessOnly) {
        state.chats.unshift({ text: userId + " guessed incorrectly and " + request.user.id + " won!", sentAt: ctx.time});
        state.winner = request.user.id;
        // TODO: How to end game?
      } else {
        state.chats.unshift({ text: userId + " guessed incorrectly ;(", sentAt: ctx.time});
      }
    }

    // update turn
    state.turnIdx = (state.turnIdx + 1) % state.hands.length;
    return Response.ok();
  }

  answer(state: InternalState, userId: UserId, ctx: Context, request: IAnswerRequest): Response {
    // log the answer
    state.chats.unshift({ text: userId + " answered: " + request.answer, sentAt: ctx.time});
    return Response.ok();
  }

  getUserState(state: InternalState, userId: UserId): PlayerState {
    // compute the user state from the internal state
    return {
      hand: state.hands.find((hand) => hand.userId === userId)?.numberCards ?? [],
      players: state.hands.map((hand) => ({ id: hand.userId, numCards: hand.numberCards.length })),
      turn: state.currQuestions !== undefined ? state.hands[state.turnIdx].userId : undefined,
      questionPile: state.currQuestions ?? [],
      log: state.chats,
      winner: state.winner
    };
  }
}