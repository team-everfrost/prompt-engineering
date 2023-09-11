export const preprocess = (datas) => {
  const processedDatas = datas.map((data) => {
    const { title, content, type } = data;
    let processedContent = content;
    if (type === 'webpage') {
      processedContent = content.replace(/<[^>]*>?/gm, '');
    }


    const length = content.length;
    if (length > 3000) {
      processedContent =
        content.slice(0, 1000) +
        '\n\n...\n\n' +
        content.slice(length / 2 - 500, length / 2 + 500) +
        '\n\n...\n\n' +
        content.slice(length - 1000, length);
    }

    const dataStr = `type: ${type}\n${processedContent}`;
    return dataStr;
  });

  return processedDatas;
};
