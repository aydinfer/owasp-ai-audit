package main

import (
	"context"

	openai "github.com/sashabaranov/go-openai"
)

func ask(client *openai.Client, ctx context.Context, req openai.ChatCompletionRequest) {
	client.CreateChatCompletion(ctx, req)
}

func main() {
	ctx := context.Background()
	client := openai.NewClient("key")
	client.CreateEmbeddings(ctx, openai.EmbeddingRequest{})
	_ = ctx
}
