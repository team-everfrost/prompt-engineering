export const prompt = {
  temperature: 0,
  prompt: `You are a helpful AI assistant for 'write a summary' and 'extract hashtags' of the following document.
    ---
    You should write two kinds of summaries: 'one-sentence summary' and 'one paragraph summary'.
    A 'one-sentence summary' is a sentence that expresses the contents of the entire document, not the title of the document. It should be a concise one sentence.
    A 'one-paragraph-summary' is a summary of the document and should be concise and concise, within one paragraph.
    Craft a summary that is detailed, thorough, in-depth, and complex, while maintaining clarity and conciseness.
    Incorporate main ideas and essential information, eliminating extraneous language and focusing on critical aspects.
    Rely strictly on the provided text, without including external information.
    ---
    Your next job is to extract hashtags from the document.
    Please extract general hashtags so that you can collect documents with similar contents, and also extract specific hashtags to know the core contents of the documents.
    I will specify the language for summary and hashtag.
    But you can add 'english word' in hashtags for proper nouns like 'COVID-19', 'React'.
    Hashtag should be a clear word.
    If hashtag is english, please use 'lower case'.
    ---
    Language for summary and hashtags: Korean
    Document: \n
    `,
  functions: [
    {
      name: "insertMetadata",
      description: "Inserts summary and hashtags into the article metadata",
      parameters: {
        type: "object",
        properties: {
          oneLineSummary: {
            type: "string",
            description:
              "a concise summary of the entire document within one sentence",
          },
          summary: {
            type: "string",
            description:
              "concise, one-paragraph or less summary of the entire document",
          },
          hashtags: {
            type: "array",
            items: {
              type: "string",
            },
            description: "A list of hashtags for the article",
          },
        },
        required: ["oneLineSummary", "summary", "hashtags"],
      },
    },
  ],
  function_call: {
    name: "insertMetadata",
  },
};

export const preprocessor = (datas) => {
  const processedDatas = datas.map((data) => {
    const { title, content, type } = data;
    let processedContent = content;
    if (type === "webpage") {
      processedContent = content.replace(/<[^>]*>?/gm, "");
    }

    const length = content.length;
    if (length > 3000) {
      processedContent =
        content.slice(0, 1000) +
        "\n\n...\n\n" +
        content.slice(length / 2 - 500, length / 2 + 500) +
        "\n\n...\n\n" +
        content.slice(length - 1000, length);
    }

    const dataStr = `type: ${type}\n${processedContent}`;
    return dataStr;
  });

  return processedDatas;
};
