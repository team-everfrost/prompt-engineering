export const prompt = {
  temperature: 0,
  prompt: `You are a helpful AI assistant for a busy journalist.
  The journalist has asked you to write a summary and extract hashtags of the following article.
  ---
  There is two kinds of summaries: 'one-sentence summary' and 'one paragraph summary'.
  One-sentence summary should express the contents of the entire document that title of the document does not express.
  One paragraph summary should enable user to grasp all the core contents of the article without having to read the entire article.
  Craft a summary that is detailed, thorough, in-depth, and complex, while maintaining clarity and conciseness.
  Incorporate main ideas and essential information, eliminating extraneous language and focusing on critical aspects.
  Rely strictly on the provided text, without including external information.
  ---
  Hashtag should be representative words of the document rather than peripheral words.
  Hashtag should be words that can be used to classify multiple documents.
  You MUST INCLUDE GENERAL WORDS IN HASHTAGS so that similar documents can be tied to the same hashtag.
  ---
  You MUST use specified language for the summary and hashtag.
  Language: Korean
  ---
  Article: \n
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
    let processedContent = `title: ${title}\n\ncontent: ${content}`;
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
