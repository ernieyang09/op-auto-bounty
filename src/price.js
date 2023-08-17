const priceCache = {}


const fetchPrice = async (token) => {
  if (priceCache[token]) {
    return priceCache[token]
  }
  let ret = 0
  
  const res = await (await fetch(`https://api.portals.fi/v2/tokens?networks=optimism&ids=optimism:${token}`)).json()
  ret = res.tokens[0].price

  priceCache[token] = ret
  return priceCache[token]
}

module.exports = fetchPrice