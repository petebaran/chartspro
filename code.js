figma.showUI(__html__, { 
  width: 400, 
  height: 700,
  themeColors: true 
});

console.log('CC Charts Pro initialized');

figma.ui.onmessage = async function(msg) {
  if (msg.type === 'chart-data') {
    try {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      await figma.loadFontAsync({ family: "Reddit Mono", style: "Regular" });
      
      const data = msg.data;
      const config = msg.config || {
        width: 600,
        height: 400,
        bullColor: '#00b386',
        bearColor: '#ff4d4d',
        showPriceGrid: true,
        showDateGrid: true,
        showVolume: false,
        transparentBackground: false,
        strokeWeight: 1
      };

      const timestamps = data.timestamp;
      const ohlc = data.indicators.quote[0];
      const volumes = (data.indicators.quote[0].volume) || [];
      
      const canvasWidth = config.width;
      const canvasHeight = config.height;
      const volumeHeight = config.showVolume ? Math.floor(canvasHeight * 0.2) : 0;
      const chartHeight = canvasHeight - volumeHeight;
      
      // Build descriptive title with all parameters
      const symbolMatch = (data.meta && data.meta.symbol) || currentSymbol || "CHART";
      const intervalText = msg.interval || "1d";
      const timeframeText = getTimeframeDisplayText(msg.timeframe || "30");
      const sizeText = canvasWidth + "x" + canvasHeight;
      const frameTitle = symbolMatch + " | " + intervalText + " | " + timeframeText + " | " + sizeText;
      
      // Create main frame
      const frame = figma.createFrame();
      frame.resize(canvasWidth, canvasHeight);
      frame.name = frameTitle;
      
      // Set background based on config
      if (config.transparentBackground) {
        frame.fills = [];
      } else {
        frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      }
      
      frame.cornerRadius = 8;
      frame.effects = [{
        type: 'DROP_SHADOW',
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        blendMode: 'NORMAL',
        offset: { x: 0, y: 2 },
        radius: 8,
        spread: 0
      }];
      figma.currentPage.appendChild(frame);

      // Create layers for organization
      const backgroundLayer = figma.createFrame();
      backgroundLayer.name = "Background";
      backgroundLayer.resize(canvasWidth, canvasHeight);
      backgroundLayer.fills = [];
      frame.appendChild(backgroundLayer);

      const gridLayer = figma.createFrame();
      gridLayer.name = "Grid";
      gridLayer.resize(canvasWidth, chartHeight);
      gridLayer.fills = [];
      backgroundLayer.appendChild(gridLayer);

      const labelsLayer = figma.createFrame();
      labelsLayer.name = "Labels";
      labelsLayer.resize(canvasWidth, canvasHeight);
      labelsLayer.fills = [];
      backgroundLayer.appendChild(labelsLayer);

      const candlesLayer = figma.createFrame();
      candlesLayer.name = "Candles";
      candlesLayer.resize(canvasWidth, chartHeight);
      candlesLayer.fills = [];
      frame.appendChild(candlesLayer);

      let volumeLayer = null;
      if (config.showVolume) {
        volumeLayer = figma.createFrame();
        volumeLayer.name = "Volume";
        volumeLayer.resize(canvasWidth, volumeHeight);
        volumeLayer.y = chartHeight;
        volumeLayer.fills = [];
        frame.appendChild(volumeLayer);
      }

      // Dynamic layout: Calculate space needed for price labels first
      const candleCount = timestamps.length;
      
      const topPadding = 40;
      const bottomPadding = 40;
      const leftPadding = 24;
      const framePadding = 24; // 32px padding from frame edge
      const gapBetweenChartAndPrices = 24; // 24px gap between chart and prices
      
      const availableHeight = chartHeight - topPadding - bottomPadding;

      // Calculate price range with 5% padding
      let minPrice = Infinity;
      let maxPrice = -Infinity;
      for (let i = 0; i < timestamps.length; i++) {
        const high = ohlc.high[i];
        const low = ohlc.low[i];
        if (high != null && high > maxPrice) maxPrice = high;
        if (low != null && low < minPrice) minPrice = low;
      }

      const priceRange = maxPrice - minPrice;
      const padding = priceRange * 0.05;
      minPrice -= padding;
      maxPrice += padding;
      const adjustedRange = maxPrice - minPrice;
      const scale = availableHeight / adjustedRange;

      // STEP 1: Create temporary text nodes to measure maximum price label width
      const numPriceLines = 8;
      let maxPriceLabelWidth = 0;
      const tempPriceTexts = [];
      
      for (let i = 0; i <= numPriceLines; i++) {
        const price = minPrice + (adjustedRange * i / numPriceLines);
        
        // Skip top and bottom lines like in the original code
        if (i === 0 || i === numPriceLines) continue;
        
        const tempPriceText = figma.createText();
        tempPriceText.characters = formatPrice(price);
        tempPriceText.fontSize = 10;
        tempPriceText.fontName = { family: "Reddit Mono", style: "Regular" };
        tempPriceTexts.push(tempPriceText);
        
        // Measure this price text width
        const textWidth = tempPriceText.width;
        maxPriceLabelWidth = Math.max(maxPriceLabelWidth, textWidth);
      }
      
      // STEP 2: Calculate layout based on measured price text width
      const rightPadding = framePadding + maxPriceLabelWidth + gapBetweenChartAndPrices;
      const candleAreaWidth = canvasWidth - leftPadding - rightPadding;
      
      // Size candlesticks to fit the calculated area
      const candleWidth = Math.max(1, Math.min(8, candleAreaWidth / candleCount * 0.8));
      const spacing = Math.max(0.5, (candleAreaWidth - candleCount * candleWidth) / (candleCount - 1));
      
      // Calculate actual candlestick area width
      const actualCandleAreaWidth = candleCount * candleWidth + (candleCount - 1) * spacing;
      
      // Position price labels with proper spacing
      const priceLabelX = leftPadding + actualCandleAreaWidth + gapBetweenChartAndPrices;
      
      // Clean up temporary text nodes
      tempPriceTexts.forEach(text => text.remove());

      // Create title
      const titleText = figma.createText();
      titleText.characters = symbolMatch + " - Candlestick Chart";
      titleText.x = leftPadding;
      titleText.y = 15;
      titleText.fontSize = 16;
      titleText.fontName = { family: "Inter", style: "Regular" };
      titleText.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.482, b: 0.573 } }];
      titleText.name = "Chart Title";
      labelsLayer.appendChild(titleText);

      // Draw enhanced grid lines and labels
      if (config.showPriceGrid) {
        const numPriceLines = 8;
        for (let i = 0; i <= numPriceLines; i++) {
          const price = minPrice + (adjustedRange * i / numPriceLines);
          const y = topPadding + (maxPrice - price) * scale;

          // Skip top and bottom lines (remove the #B3B3B3 lines)
          if (i === 0 || i === numPriceLines) continue;

          // Draw horizontal dashed grid line using Figma's built-in dashed style
          const gridLine = figma.createLine();
          gridLine.strokeWeight = 0.5;
          gridLine.strokes = [{ type: 'SOLID', color: { r: 0.804, g: 0.82, b: 0.835 } }];
          gridLine.strokeCap = 'SQUARE';
          gridLine.strokeJoin = 'MITER';
          gridLine.dashPattern = [2, 3]; // Dash: 2, Gap: 3
          gridLine.x = leftPadding;
          gridLine.y = y;
          gridLine.resize(candleAreaWidth, 0);
          gridLayer.appendChild(gridLine);

          // Price label (always show with Reddit Mono) positioned at right edge
          const priceText = figma.createText();
          priceText.characters = formatPrice(price);
          priceText.fontSize = 10;
          priceText.fontName = { family: "Reddit Mono", style: "Regular" };
          priceText.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.482, b: 0.573 } }];
          priceText.name = "Price Label " + price.toFixed(2);
          // Price labels positioned relative to candlestick area
          priceText.x = priceLabelX;
          priceText.y = y - 5;
          labelsLayer.appendChild(priceText);
        }
      }



      // Draw enhanced date grid lines and labels (limited to 3: start, middle, end)
      if (config.showDateGrid) {
        const dateIndices = [
          0, // Start
          Math.floor(timestamps.length / 2), // Middle  
          timestamps.length - 1 // End
        ];

        for (let idx = 0; idx < dateIndices.length; idx++) {
          const i = dateIndices[idx];
          let x = leftPadding + i * (candleWidth + spacing);
          
          // Special positioning for first date label - 24px from left side
          if (idx === 0) {
            x = 24;
          }

          // Note: Vertical lines are now drawn for all candlesticks in the section below

          const date = new Date(timestamps[i] * 1000);
          const dateStr = formatDate(date, timestamps.length);

          const dateText = figma.createText();
          dateText.characters = dateStr;
          // Simple, working date positioning
          if (idx === 0) {
            // First date: at start of candlestick area
            dateText.x = leftPadding;
          } else if (idx === dateIndices.length - 1) {
            // Last date: centered under last candlestick
            const lastCandleX = leftPadding + (timestamps.length - 1) * (candleWidth + spacing);
            dateText.x = lastCandleX + (candleWidth / 2) - 25; // Center under last candle
          } else {
            // Middle date: centered under its candlestick
            dateText.x = x - 25; // Center under the candlestick
          }
          dateText.y = chartHeight - 25;
          dateText.fontSize = 10;
          dateText.fontName = { family: "Reddit Mono", style: "Regular" };
          dateText.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.482, b: 0.573 } }];
          
          // Set text alignment: first date to left, last date to right, others to center
          if (idx === 0) {
            dateText.textAlignHorizontal = 'LEFT';
          } else if (idx === dateIndices.length - 1) {
            dateText.textAlignHorizontal = 'RIGHT';
          } else {
            dateText.textAlignHorizontal = 'CENTER';
          }
          
          dateText.name = "Date Label " + dateStr;
          labelsLayer.appendChild(dateText);
        }
      }

      // Calculate volume range if needed
      let maxVolume = 0;
      if (config.showVolume && volumes.length > 0) {
        for (let i = 0; i < volumes.length; i++) {
          if (volumes[i] != null && volumes[i] > maxVolume) {
            maxVolume = volumes[i];
          }
        }
      }

      // Draw candles with proper filled bodies and accurate wicks
      for (let i = 0; i < timestamps.length; i++) {
        const open = ohlc.open[i];
        const high = ohlc.high[i];
        const low = ohlc.low[i];
        const close = ohlc.close[i];
        if (open == null || high == null || low == null || close == null) continue;

        const isBullish = close >= open;
        const color = isBullish ? config.bullColor : config.bearColor;
        const rgb = hexToRgb(color);

        const yHigh = topPadding + (maxPrice - high) * scale;
        const yLow = topPadding + (maxPrice - low) * scale;
        const yOpen = topPadding + (maxPrice - open) * scale;
        const yClose = topPadding + (maxPrice - close) * scale;

        let x = leftPadding + i * (candleWidth + spacing);
        
        // Special positioning for first candlestick - 24px from left side
        if (i === 0) {
          x = 24;
        }

        // Draw wick using rectangle for better control (thin vertical line)
        const wickHeight = Math.abs(yLow - yHigh);
        if (wickHeight > 0) {
          const wick = figma.createRectangle();
          wick.resize(config.strokeWeight, wickHeight); // Use full stroke weight for wick width
          wick.fills = [{ type: 'SOLID', color: rgb }];
          wick.x = x + candleWidth / 2 - (config.strokeWeight / 2);
          wick.y = Math.min(yHigh, yLow);
          wick.name = "Wick " + i;
          candlesLayer.appendChild(wick);
        }

        // Draw body (open to close) - FILLED rectangle
        const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
        const body = figma.createRectangle();
        body.resize(candleWidth, bodyHeight);
        body.x = x;
        body.y = Math.min(yOpen, yClose);
        
        // FILLED candle bodies (not just stroke)
        body.fills = [{ type: 'SOLID', color: rgb }];
        body.strokes = []; // Remove stroke to get clean filled appearance
        body.name = "Candle " + i;
        candlesLayer.appendChild(body);

        // Draw volume bars if enabled
        if (config.showVolume && volumes[i] != null && volumeLayer && maxVolume > 0) {
          const volume = volumes[i];
          const volumeBarHeight = Math.max(2, (volume / maxVolume) * (volumeHeight - 20));
          
          if (volumeBarHeight > 2) {
            const volumeBar = figma.createRectangle();
            volumeBar.resize(candleWidth * 0.8, volumeBarHeight);
            
            // Proper RGB color validation for volume bars
            const validRgb = {
              r: Math.max(0, Math.min(1, rgb.r)),
              g: Math.max(0, Math.min(1, rgb.g)),
              b: Math.max(0, Math.min(1, rgb.b))
            };
            
            volumeBar.fills = [{ 
              type: 'SOLID', 
              color: validRgb,
              opacity: 0.7
            }];
            volumeBar.x = x + (candleWidth * 0.1);
            volumeBar.y = volumeHeight - volumeBarHeight - 10;
            volumeBar.name = "Volume " + i;
            volumeLayer.appendChild(volumeBar);
          }
        }
      }



      // Add current price line and tag
      const currentPrice = ohlc.close[ohlc.close.length - 1];
      const firstPrice = ohlc.open[0];
      const isCurrentPriceBullish = currentPrice >= firstPrice;
      const currentPriceColor = isCurrentPriceBullish ? config.bullColor : config.bearColor;
      const currentPriceRgb = hexToRgb(currentPriceColor);
      
      // Calculate current price Y position
      const currentPriceY = topPadding + (maxPrice - currentPrice) * scale;
      
      // Create current price dashed line
      const currentPriceLine = figma.createLine();
      currentPriceLine.strokeWeight = 1;
      currentPriceLine.strokes = [{ type: 'SOLID', color: currentPriceRgb }];
      currentPriceLine.strokeCap = 'SQUARE';
      currentPriceLine.strokeJoin = 'MITER';
      currentPriceLine.dashPattern = [2, 4]; // Dash: 4, Gap: 4
      currentPriceLine.x = leftPadding;
      currentPriceLine.y = currentPriceY;
      currentPriceLine.resize(actualCandleAreaWidth, 0);
      currentPriceLine.name = "Current Price Line";
      gridLayer.appendChild(currentPriceLine);
      
      // Create current price tag text with proper settings
      const priceTagText = figma.createText();
      priceTagText.characters = formatPrice(currentPrice);
      priceTagText.fontSize = 10;
      priceTagText.fontName = { family: "Reddit Mono", style: "Regular" };
      priceTagText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]; // White text
      priceTagText.textAlignHorizontal = 'CENTER';
      priceTagText.textAlignVertical = 'CENTER';
      priceTagText.textAutoResize = 'WIDTH_AND_HEIGHT'; // Auto width
      priceTagText.textTruncation = 'DISABLED';
      priceTagText.name = "Current Price Tag";
      
      // Set text vertical trim from cap height to baseline
      try {
        priceTagText.leadingTrim = 'CAP_HEIGHT';
      } catch (e) {
        // Fallback if leadingTrim is not available
      }
      
      // Create current price tag background with 8px padding
      const horizontalPadding = 8;
      const verticalPadding = 8;
      const priceTagTextWidth = priceTagText.width;
      const priceTagTextHeight = priceTagText.height;
      const priceTagWidth = priceTagTextWidth + (horizontalPadding * 2);
      const priceTagHeight = priceTagTextHeight + (verticalPadding * 2);
      
      // Position the price tag centered to price range with 16px padding from frame edge
      const priceTagX = canvasWidth - 16 - priceTagWidth;
      const priceTagY = currentPriceY - (priceTagHeight / 2);
      
      const priceTagBg = figma.createRectangle();
      priceTagBg.resize(priceTagWidth, priceTagHeight);
      priceTagBg.x = priceTagX;
      priceTagBg.y = priceTagY;
      priceTagBg.fills = [{ type: 'SOLID', color: currentPriceRgb }];
      priceTagBg.cornerRadius = 3;
      priceTagBg.name = "Current Price Tag Background";
      labelsLayer.appendChild(priceTagBg);
      
      // Position text centered within the background
      priceTagText.x = priceTagX + horizontalPadding;
      priceTagText.y = priceTagY + verticalPadding;
      labelsLayer.appendChild(priceTagText);

      // Add volume label if volume is shown
      if (config.showVolume && volumeLayer) {
        const volumeTitle = figma.createText();
        volumeTitle.characters = "Volume";
        volumeTitle.x = 10;
        volumeTitle.y = chartHeight + 5;
        volumeTitle.fontSize = 12;
        volumeTitle.fontName = { family: "Reddit Mono", style: "Regular" };
        volumeTitle.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.482, b: 0.573 } }];
        volumeTitle.name = "Volume Label";
        labelsLayer.appendChild(volumeTitle);
      }

      figma.viewport.scrollAndZoomIntoView([frame]);
      
      const priceChange = ohlc.close[ohlc.close.length - 1] - ohlc.open[0];
      const percentChange = ((priceChange / ohlc.open[0]) * 100).toFixed(2);
      const changeText = priceChange >= 0 ? "+" + percentChange + "%" : percentChange + "%";
      
      figma.notify("Chart generated successfully! " + changeText, { timeout: 3000 });
      
    } catch (error) {
      console.error('Error:', error);
      figma.notify("Error: " + error.message, { error: true });
    }
  }
};

async function createCandlestickChart(dataPoints, config, symbol) {
  const canvasWidth = config.width;
  const canvasHeight = config.height;
  const padding = { top: 40, right: 40, bottom: 40, left: 60 };
  const volumeHeight = config.showVolume ? Math.floor(canvasHeight * 0.25) : 0;
  const chartHeight = canvasHeight - volumeHeight - padding.top - padding.bottom;
  const chartWidth = canvasWidth - padding.left - padding.right;

  // Create main frame
  const frame = figma.createFrame();
  frame.resize(canvasWidth, canvasHeight);
  frame.name = `${symbol} Candlestick Chart`;
  
  // Set background
  if (config.transparentBackground) {
    frame.fills = [];
  } else {
    frame.fills = [{ 
      type: 'SOLID', 
      color: { r: 1, g: 1, b: 1 } 
    }];
  }
  
  frame.cornerRadius = 8;
  frame.effects = [{
    type: 'DROP_SHADOW',
    visible: true,
    color: { r: 0, g: 0, b: 0, a: 0.1 },
    blendMode: 'NORMAL',
    offset: { x: 0, y: 2 },
    radius: 8,
    spread: 0
  }];
  
  figma.currentPage.appendChild(frame);

  // Calculate price range
  const prices = dataPoints.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;
  const pricePadding = priceRange * 0.1;

  // Calculate volume range if needed
  let maxVolume = 0;
  if (config.showVolume) {
    maxVolume = Math.max(...dataPoints.map(d => d.volume));
  }

  // Create chart layers
  const chartArea = figma.createFrame();
  chartArea.name = "Chart Area";
  chartArea.resize(chartWidth, chartHeight);
  chartArea.x = padding.left;
  chartArea.y = padding.top;
  chartArea.fills = [];
  chartArea.clipsContent = true;
  frame.appendChild(chartArea);

  // Create grids if enabled
  if (config.showPriceGrid || config.showDateGrid) {
    await createGridLines(chartArea, chartWidth, chartHeight, config);
  }

  // Create candlesticks
  const candleWidth = Math.max(1, Math.floor(chartWidth / dataPoints.length * 0.7));
  const candleSpacing = chartWidth / dataPoints.length;

  for (let i = 0; i < dataPoints.length; i++) {
    const point = dataPoints[i];
    const x = i * candleSpacing + candleSpacing / 2;
    
    const isUp = point.close >= point.open;
    const color = hexToRgb(isUp ? config.bullColor : config.bearColor);
    
    await createCandlestick(
      chartArea,
      x,
      point,
      candleWidth,
      chartHeight,
      minPrice - pricePadding,
      maxPrice + pricePadding,
      color,
      config.strokeWeight
    );
  }

  // Create volume bars if enabled
  if (config.showVolume && maxVolume > 0) {
    const volumeArea = figma.createFrame();
    volumeArea.name = "Volume Area";
    volumeArea.resize(chartWidth, volumeHeight);
    volumeArea.x = padding.left;
    volumeArea.y = canvasHeight - volumeHeight - padding.bottom;
    volumeArea.fills = [];
    frame.appendChild(volumeArea);

    for (let i = 0; i < dataPoints.length; i++) {
      const point = dataPoints[i];
      const x = i * candleSpacing + candleSpacing / 2;
      const volumePercent = point.volume / maxVolume;
      const barHeight = volumeHeight * volumePercent;
      
      const isUp = point.close >= point.open;
      const color = hexToRgb(isUp ? config.bullColor : config.bearColor);
      
      if (barHeight > 0) {
        createVolumeBar(volumeArea, x, barHeight, candleWidth, volumeHeight, color);
      }
    }
  }

  // Add title
  await createTitle(frame, symbol, canvasWidth);

  // Add price labels
  await createPriceLabels(frame, minPrice - pricePadding, maxPrice + pricePadding, chartHeight, padding);
}

async function createCandlestick(parent, x, point, width, chartHeight, minPrice, maxPrice, color, strokeWeight) {
  const priceRange = maxPrice - minPrice;
  
  // Convert prices to y-coordinates (inverted because y increases downward)
  const highY = chartHeight * (1 - (point.high - minPrice) / priceRange);
  const lowY = chartHeight * (1 - (point.low - minPrice) / priceRange);
  const openY = chartHeight * (1 - (point.open - minPrice) / priceRange);
  const closeY = chartHeight * (1 - (point.close - minPrice) / priceRange);

  // Create wick (high-low line)
  const wick = figma.createLine();
  wick.strokeWeight = strokeWeight;
  wick.strokes = [{
    type: 'SOLID',
    color: color
  }];
  wick.strokeCap = 'ROUND';
  
  // Set wick position and size
  wick.x = x;
  wick.y = highY;
  wick.resize(0, lowY - highY);
  
  parent.appendChild(wick);

  // Create body
  const bodyTop = Math.min(openY, closeY);
  const bodyBottom = Math.max(openY, closeY);
  const bodyHeight = Math.max(1, bodyBottom - bodyTop); // Ensure minimum height of 1

  if (bodyHeight > strokeWeight) {
    // Create filled rectangle for body
    const body = figma.createRectangle();
    body.x = x - width / 2;
    body.y = bodyTop;
    body.resize(width, bodyHeight);
    
    // Use stroke instead of fill for consistent appearance
    body.fills = [];
    body.strokes = [{
      type: 'SOLID',
      color: color
    }];
    body.strokeWeight = strokeWeight;
    
    parent.appendChild(body);
  } else {
    // For very small bodies, just use a horizontal line
    const bodyLine = figma.createLine();
    bodyLine.strokeWeight = strokeWeight;
    bodyLine.strokes = [{
      type: 'SOLID',
      color: color
    }];
    bodyLine.strokeCap = 'ROUND';
    bodyLine.x = x - width / 2;
    bodyLine.y = (openY + closeY) / 2;
    bodyLine.resize(width, 0);
    
    parent.appendChild(bodyLine);
  }
}

function createVolumeBar(parent, x, barHeight, width, volumeHeight, color) {
  try {
    const volumeBar = figma.createRectangle();
    volumeBar.x = x - width / 2;
    volumeBar.y = volumeHeight - barHeight;
    volumeBar.resize(width, barHeight);
    
    // Ensure proper RGB color format
    const validColor = {
      r: Math.max(0, Math.min(1, color.r || 0)),
      g: Math.max(0, Math.min(1, color.g || 0)),
      b: Math.max(0, Math.min(1, color.b || 0))
    };

    volumeBar.fills = [{
      type: 'SOLID',
      color: validColor,
      opacity: 0.6
    }];
    
    parent.appendChild(volumeBar);
  } catch (error) {
    console.error('Error creating volume bar:', error);
    // Create fallback volume bar with default color
    const volumeBar = figma.createRectangle();
    volumeBar.x = x - width / 2;
    volumeBar.y = volumeHeight - barHeight;
    volumeBar.resize(width, barHeight);
    volumeBar.fills = [{
      type: 'SOLID',
      color: { r: 0.5, g: 0.5, b: 0.5 },
      opacity: 0.6
    }];
    parent.appendChild(volumeBar);
  }
}

async function createGridLines(parent, width, height, config) {
  const gridColor = { r: 0.804, g: 0.82, b: 0.835 };

  if (config.showPriceGrid) {
    // Horizontal grid lines (price levels)
    for (let i = 1; i < 5; i++) {
      const y = (height / 5) * i;
      // Draw dashed line manually using helper to avoid assigning unsupported properties
      drawHorizontalDashedLine(parent, 0, y, width, gridColor, 0.5);
    }
  }

  if (config.showDateGrid) {
    // Vertical grid lines (time intervals)
    for (let i = 1; i < 5; i++) {
      const x = (width / 5) * i;
      // Draw dashed line manually using helper to avoid assigning unsupported properties
      drawVerticalDashedLine(parent, x, 0, height, gridColor, 0.5);
    }
  }
}

async function createTitle(parent, symbol, width) {
  const title = figma.createText();
  title.characters = `${symbol} Candlestick Chart`;
  title.fontSize = 16;
  title.fontName = { family: "Inter", style: "Medium" };
  title.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  
  await figma.loadFontAsync(title.fontName);
  
  // Center the title
  title.x = (width - title.width) / 2;
  title.y = 12;
  
  parent.appendChild(title);
}

async function createPriceLabels(parent, minPrice, maxPrice, chartHeight, padding) {
  const labelCount = 5;
  const priceStep = (maxPrice - minPrice) / (labelCount - 1);
  
  for (let i = 0; i < labelCount; i++) {
    const price = minPrice + (i * priceStep);
    const y = padding.top + chartHeight - (i * chartHeight / (labelCount - 1));
    
    const label = figma.createText();
    label.characters = price.toFixed(2);
    label.fontSize = 10;
    label.fontName = { family: "Inter", style: "Regular" };
    label.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
    
    await figma.loadFontAsync(label.fontName);
    
    // Position price labels on the right side of the chart instead of the left.
    // Place the label just beyond the chart's right padding, with a small offset.
    label.x = parent.width - padding.right + 10;
    label.y = y - label.height / 2;
    
    parent.appendChild(label);
  }
}

function hexToRgb(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255
  };
}

function formatPrice(price) {
  let formattedPrice;
  
  if (price >= 1) {
    formattedPrice = price.toFixed(2);
  } else if (price >= 0.01) {
    formattedPrice = price.toFixed(3);
  } else {
    formattedPrice = price.toFixed(6);
  }
  
  // Add comma separators
  const parts = formattedPrice.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function formatDate(date, dataLength) {
  if (dataLength <= 50) {
    // Short term - show time
    return date.toLocaleDateString('en-US', { 
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } else if (dataLength <= 200) {
    // Medium term - show date
    return date.toLocaleDateString('en-US', { 
      month: 'short',
      day: 'numeric'
    });
  } else {
    // Long term - show month/year
    return date.toLocaleDateString('en-US', { 
      year: '2-digit',
      month: 'short'
    });
  }
}

function getTimeframeDisplayText(timeframe) {
  // Handle custom date range format
  if (typeof timeframe === 'string' && timeframe.startsWith('Custom')) {
    return timeframe;
  }
  
  const timeframeMap = {
    "1": "1D",
    "5": "5D", 
    "30": "1M",
    "90": "3M",
    "180": "6M",
    "365": "1Y",
    "ytd": "YTD",
    "1825": "5Y",
    "max": "All",
    "custom": "Custom"
  };
  return timeframeMap[timeframe] || timeframe;
}

// Helper to draw dashed lines manually by creating many small line segments.
// Figma nodes are frozen and do not allow adding unsupported properties like strokeDashPattern.
// To achieve a dashed look, we break the line into small segments with gaps between them.
// This helper draws a horizontal dashed line across a given width starting at a specific x and y.
function drawHorizontalDashedLine(parent, startX, y, width, color, strokeWeight = 0.5) {
  const dashLength = 4; // length of dash segment in px
  const gapLength = 4;  // length of gap between dashes in px
  let x = 0;
  while (x < width) {
    const segmentLength = Math.min(dashLength, width - x);
    const dash = figma.createLine();
    dash.strokeWeight = strokeWeight;
    dash.strokes = [{ type: 'SOLID', color }];
    dash.x = startX + x;
    dash.y = y;
    dash.resize(segmentLength, 0);
    parent.appendChild(dash);
    x += dashLength + gapLength;
  }
}

// Helper to draw dashed vertical line across a given height starting from top y.
// Accepts x coordinate for line location and draws segments along the y axis.
function drawVerticalDashedLine(parent, x, startY, height, color, strokeWeight = 0.5) {
  const dashLength = 4;
  const gapLength = 4;
  let y = 0;
  while (y < height) {
    const segmentLength = Math.min(dashLength, height - y);
    const dash = figma.createLine();
    dash.strokeWeight = strokeWeight;
    dash.strokes = [{ type: 'SOLID', color }];
    dash.x = x;
    dash.y = startY + y;
    dash.resize(0, segmentLength);
    parent.appendChild(dash);
    y += dashLength + gapLength;
  }
}