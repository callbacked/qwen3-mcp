import {
  AutoTokenizer,
  AutoModelForCausalLM
} from "@huggingface/transformers";

/**
 * This class uses the Singleton pattern to enable lazy-loading of the pipeline
 */
export class TextGenerationPipeline {
  static model_id = "onnx-community/Qwen3-0.6B-ONNX";
  static tokenizer = null;
  static model = null;

  static async getInstance(progress_callback = null) {
    if (!this.tokenizer) {
      this.tokenizer = AutoTokenizer.from_pretrained(this.model_id, {
        progress_callback,
      });
    }
    if (!this.model) {
      this.model = AutoModelForCausalLM.from_pretrained(this.model_id, {
        dtype: "q4f16",
        device: "webgpu",
        progress_callback,
      });
    }
    return Promise.all([await this.tokenizer, await this.model]);
  }
}

export async function loadModelAndWarmup(postMessageCallback) {
  postMessageCallback({ status: "loading", data: "Loading model..." });
  try {
    const model_id_for_ui = TextGenerationPipeline.model_id;
    await TextGenerationPipeline.getInstance((x) => { postMessageCallback(x); });
    postMessageCallback({ status: "loading", data: "Compiling shaders and warming up model..." });
    const [tokenizer, model] = await TextGenerationPipeline.getInstance();
    const inputs = tokenizer("a");
    await model.generate({ ...inputs, max_new_tokens: 1 });
    postMessageCallback({ status: "ready" });
    postMessageCallback({
      type: "model_loaded_info",
      data: {
        name: model_id_for_ui,
        url: `https://huggingface.co/${model_id_for_ui}`
      }
    });
  } catch (e) {
    console.error("Error during model load:", e);
    postMessageCallback({ status: "error", data: "Error during model load: " + e.message });
  }
} 