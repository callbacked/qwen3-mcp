# Qwen3-MCP

**An MCP-enabled Qwen3 0.6B demo with local tool-use and adjustable thinking budget, all in your browser!**

## Overview

This project began as an adaptation of Xenova's excellent [Qwen3 0.6B WebGPU demo code](https://github.com/huggingface/transformers.js-examples/tree/main/qwen3-webgpu), which provided a solid foundation for model initialization and UI. Qwen3-MCP builds upon this by integrating MCP support client, the ability to control thinking length, and a new UI design.


The motivation came from the fact that **all** Qwen3 models have tool calling support, and with 0.6B being
surprisingly coherent in considering its very tiny size. Therefore, I was curious to see how far I can take this model in general tool calling tasks.

Additionally, it served as an exercise to implement a way of limiting how long Qwen3 can think, by giving it a max "Thinking Budget" of N tokens before providing a final answer. That way we can avoid Qwen3 "overthinking" sometimes. The idea for that came [from an article by Zach Mueller](https://muellerzr.github.io/til/end_thinking.html) describing how it can be acheived. It was a great read!

## Demo


*As of writing this, There is a DeepSeek R1-0528 Distillation of Qwen3 8B that came out not too long ago. On the off chance that a distillation for the 0.6B model releases (fingers crossed), I will be sure to add it as an option within the UI for users to download and use. It would be interesting to see how much more intelligent it can get off of DeepSeek R1-0528!*

## Key Features

*   **Reasoning/Thinking Budget:** Control how long the model can think. The user can set a number of allowed think tokens in the UI using the slider.
*   **MCP Integration:** Connect to a remote MCP server and let Qwen 0.6B work with it!. (add note that this requires SSE or streamable http servers, as stdio servers wont work)
*   **Dynamic Server Management:**
    *   Add new MCP tool servers by URL.
    *   Remove existing servers.
    *   Enable or disable entire server connections.
*   **Granular Tool Control:**
    *   Toggle individual tools on or off for each connected server.
    *   Toggle the inclusion of tool descriptions in the context sent to the model.
*   **Chat Interface:** A completely redesigned UI

## Limitations

*   **Tool Schema Token Limit:** 
    *   Typically (how I understand it atleast), a schema containing the tools can be passed through for the LLM to use via the ```apply_chat_template``` interface in transformers.js. That is how it is done in Qwen3-MCP.
    * The issue arises when you pass in **too many tools**. It leads to a GPUBuffer error once the user
    sends in their query with **over 3000 tokens worth of tools loaded** (~10,000 characters).
    * As a stopgap solution, users have granular control over what tools can be enabled in their MCP servers, with the added option of disabling descriptions of tools, as to remain under the tool schema's token limit.
    * The UI will inform of the user if they are over this 3000 token limit

### Prerequisites

*   A modern web browser with WebGPU support (e.g., Chrome, Edge).
*   Node.js and npm (for running the development server).

### Installation & Running

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/callbacked/qwen3-mcp
    cd qwen3-mcp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```

4.  Open your browser and navigate to `http://localhost:5173` 

## Using the Application

1.  **Model Loading:** The Qwen3 0.6B model will begin downloading automatically. A full download is required during the first time, but afterwards it uses the cached download 
2.  **MCP Tool Manager:**
    *   Click the wrench in the input area to open the MCP Tool Manager.
    *   **Add Servers:** Enter the URL of an MCP server of your choice.
    *   **Manage Servers:** In the "Servers" tab, you can:
        *   Enable/disable entire server connections using the toggle switch next to each server.
        *   Expand a server's details to see its available tools.
        *   Toggle individual tools on/off.
        *   Toggle whether a tool's description is sent to the model.
        *   Remove a server.
    *   **Token Count:** Observe the "Tokens: X/Y" display in the manager's header. If the current token count (X) exceeds the maximum (Y), the chat input will be disabled. You'll need to disable some tools or their descriptions to proceed.
3.  **Chatting:** Once the model is ready and (if using tools) the token count is within limits, you can chat with the Qwen3 model. If tools are available and enabled, the model may choose to use them if needed.

## Connecting to MCP Servers

Qwen3-MCP can connect to any MCP server, but a consideration for a browser app like this one is how they communicate with these servers.

**Understanding Communication Methods:**

*   **Standard I/O (`stdio`):** Many MCP server implementations use `stdio`. This means they read requests from the standard input stream and write responses to the standard output stream. This works well for local desktop tools but **browsers can't directly use `stdio`-based servers due to security restrictions.** 

So, we have to turn to network communication, which are two that can be used as per the MCP standard:

*   **Network Protocols (Streamable HTTP and SSE):** To work with Qwen3-MCP, an MCP server needs to be accessible over the network.
    *   The **newest MCP standard uses Streamable HTTP**, which allows for flexible communication, including streaming responses.
    *   An **older (more prominent) method involved using Server-Sent Events (SSE)**.
    *   **Qwen3-MCP supports both:** It's designed for the newer Streamable HTTP and can also work with older SSE-based servers.

**What This Means for Qwen3-MCP:**

You can add any MCP server to Qwen3-MCP as long as it's accessible via a URL and uses either Streamable HTTP or SSE. The main takeaway is that your MCP server needs to be reachable over the network, whether that'd be locally or remotely.

**Converting a Local stdio Server for Network Use**

If you have an existing MCP server that only communicates via `stdio`, using a tool like **[Supergateway](https://github.com/supercorp-ai/supergateway)** can wrap your stdio-based MCP server and expose it locally over the network, making it accessible to Qwen3-MCP and other web-based clients. 

**Finding Compatible MCP Servers (or making them compatible):**

*   **[Hugging Face MCP Spaces](https://huggingface.co/spaces?filter=mcp-server):** Hugging Face has spaces that act as remote MCP servers that anyone can access through a link.
*   **[Smithery](https://smithery.ai):** Smithery provides a collection of remote MCP servers that can be accessed to via a link. You can even deploy your own.
*   **Use a Bridging Tool:** Use tools like Supergateway to make your local `stdio` MCP servers network-accessible. 

## Acknowledgements

*   **Xenova** for his Qwen3 WebGPU Demo Code.
*   **Zach Mueller** for his article about limiting Qwen 3's thinking.
*   The **ONNX Community** for providing the ONNX versions of the models.


---


