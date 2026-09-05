const adapter = require('../adapters/peoplepay360.adapter');

// TODO(real-project): confirm real field names for contract records.
async function getContract(ctx) {
  const record = await adapter.get('CONTRACT', ctx);
  const { type, startDate, endDate, jobTitle } = record || {};
  return { type, startDate, endDate, jobTitle };
}

async function getContractStatus(ctx) {
  const record = await adapter.get('CONTRACT', ctx);
  const { status, endDate } = record || {};
  return { status, endDate };
}

module.exports = { getContract, getContractStatus };
