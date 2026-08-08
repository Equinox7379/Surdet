import path from 'node:path';

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function optionValues(args, name) {
  return args.flatMap((value, index) => value === name ? [args[index + 1]] : []);
}

export function parseRendererBaselineArgs(args, repositoryRoot) {
  const outputValues = optionValues(args, '--out');
  if (outputValues.length !== 1 || !outputValues[0] || outputValues[0].startsWith('--')) {
    throw new Error('必须显式指定输出路径：--out <path>');
  }
  const sourceValues = optionValues(args, '--source-equivalent-to');
  if (sourceValues.length > 1 || (sourceValues.length === 1 && !sourceValues[0])) {
    throw new Error('sourceEquivalentTo 参数只能出现一次');
  }
  const sourceEquivalentTo = sourceValues[0];
  if (sourceEquivalentTo !== undefined
    && (!SOURCE_SHA_PATTERN.test(sourceEquivalentTo) || sourceEquivalentTo.startsWith('--'))) {
    throw new Error('sourceEquivalentTo 必须是完整 40 位 SHA');
  }
  const outputValue = outputValues[0];
  return {
    outputPath: path.isAbsolute(outputValue)
      ? path.normalize(outputValue)
      : path.resolve(repositoryRoot, outputValue),
    ...(sourceEquivalentTo === undefined ? {} : { sourceEquivalentTo: sourceEquivalentTo.toLowerCase() }),
  };
}
