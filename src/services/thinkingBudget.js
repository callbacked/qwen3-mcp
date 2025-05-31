import { LogitsProcessor } from "@huggingface/transformers";

// my hero: https://muellerzr.github.io/til/end_thinking.html

export class ThinkingTokenBudgetProcessor extends LogitsProcessor {
  constructor(tokenizer, maxThinkingTokens) {
    super();
    this.tokenizer = tokenizer;
    this.maxThinkingTokens = maxThinkingTokens;
    const thinkEndTokenEncoded = this.tokenizer.encode("</think>", { add_special_tokens: false });
    this.think_end_token_id = thinkEndTokenEncoded[0];
    const nlTokenEncoded = this.tokenizer.encode("\n", { add_special_tokens: false });
    this.nl_token_id = nlTokenEncoded[0];

    this.tokens_generated = 0;
    this.stopped_thinking = false;
    this.neg_inf = -Infinity;

    if (this.think_end_token_id === undefined) {
      console.warn("</think> token ID not found. ThinkingTokenBudgetProcessor may not work correctly.");
    }
    if (this.nl_token_id === undefined) {
      console.warn("\n token ID not found. ThinkingTokenBudgetProcessor may not work correctly.");
    }
    //console.log(`[ThinkingBudget] Initialized with maxThinkingTokens: ${this.maxThinkingTokens}`);
  }

  _call(input_ids, scores) {
    if (this.stopped_thinking) {
      return scores;
    }

    this.tokens_generated += 1;
    //console.log(`[ThinkingBudget] _call: token ${this.tokens_generated}/${this.maxThinkingTokens === undefined ? 'unlimited' : this.maxThinkingTokens}`);

    // if zero budget for thinking content. Force \n then </think> immediately.
    if (this.maxThinkingTokens === 0 && !this.stopped_thinking) {
      const newScores = new Float32Array(scores.data.length).fill(this.neg_inf);
      if (this.tokens_generated === 1) { 
        //console.log("[ThinkingBudget] Zero budget: Forcing newline token.");
        if (this.nl_token_id !== undefined) {
          newScores[this.nl_token_id] = 0; // Force newline
        } else {
          console.warn("[ThinkingBudget] nl_token_id is undefined, cannot force newline. Attempting to force </think>.");
          if (this.think_end_token_id !== undefined) {
            newScores[this.think_end_token_id] = 0;
          }
          this.stopped_thinking = true;
        }
      } else if (this.tokens_generated === 2) { // Second token
        //console.log("[ThinkingBudget] Zero budget: Forcing </think> token.");
        if (this.think_end_token_id !== undefined) {
          newScores[this.think_end_token_id] = 0; // Force </think>
        }
        this.stopped_thinking = true; // Mark thinking as stopped
      } else if (this.tokens_generated > 2) {
        //console.log("[ThinkingBudget] Zero budget: Exceeded 2 tokens, forcing </think> and stopping (safeguard).");
        if (this.think_end_token_id !== undefined) {
           newScores[this.think_end_token_id] = 0;
        }
        this.stopped_thinking = true;
      }
      scores.data.set(newScores);
      return scores;
    }

    // Case 2: Positive budget for thinking content.
    if (this.maxThinkingTokens !== undefined && this.maxThinkingTokens > 0 && !this.stopped_thinking) {
      const budgetRatio = this.tokens_generated / this.maxThinkingTokens;
      //console.log(`[ThinkingBudget] Positive budget: Ratio ${budgetRatio.toFixed(2)}`);

      // last 20% of the thinking budget, push towards a natural ending \n followed by </think> (idk if this works, I'm basing a lot of this from the article. would have this test this extensively)
      if (budgetRatio > 0.80) {
        //console.log("[ThinkingBudget] Approaching budget limit ( > 80%), nudging towards newline and </think>.");
        if (this.nl_token_id !== undefined && this.think_end_token_id !== undefined && scores.data[this.think_end_token_id] !== undefined) {
          scores.data[this.nl_token_id] = scores.data[this.think_end_token_id] * (1 + budgetRatio);
          scores.data[this.think_end_token_id] = scores.data[this.think_end_token_id] * (1 + budgetRatio);
        }
      }

      // end of thinking budget, force the model to generate \n and </think>
      if (this.tokens_generated >= (this.maxThinkingTokens - 1)) {
        const newScores = new Float32Array(scores.data.length).fill(this.neg_inf);
        if (this.tokens_generated === this.maxThinkingTokens - 1) {
          //console.log("[ThinkingBudget] At budget limit - 1: Forcing newline token.");
          if (this.nl_token_id !== undefined) {
            newScores[this.nl_token_id] = 0;
          }
        } else { 
          //console.log("[ThinkingBudget] At or over budget limit: Forcing </think> token and stopping thinking.");
          if (this.think_end_token_id !== undefined) {
            newScores[this.think_end_token_id] = 0;
          }
          this.stopped_thinking = true;
        }
        scores.data.set(newScores);
        return scores; 
      }
    }

    return scores;
  }

  reset() {
    this.tokens_generated = 0;
    this.stopped_thinking = false;
  }
} 