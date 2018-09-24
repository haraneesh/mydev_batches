const Agenda = require('agenda');
const { MongoClient } = require('mongodb');

// const mongoConnectionString = 'mongodb://127.0.0.1/suvaidb';
const mongoConnectionString = process.env.MONGO_URL;

const agenda = new Agenda({ db: { address: mongoConnectionString } });

// or override the default collection name:
// var agenda = new Agenda({db: {address: mongoConnectionString, collection: 'jobCollectionName'}});

// or pass additional connection options:
// var agenda = new Agenda({db: {address: mongoConnectionString, collection: 'jobCollectionName', options: {ssl: true}}});

// or pass in an existing mongodb-native MongoClient instance
// var agenda = new Agenda({mongo: myMongoClient});

function combineOrders(productListToMerge, combinedProductList = {}) {
  const newCombinedProductList = combinedProductList;

  productListToMerge.forEach((product) => {
    if (newCombinedProductList[product._id]) {
      newCombinedProductList[product._id].orderedTimes += 1;
    } else {
      newCombinedProductList[product._id] = {
        productId: product._id,
        name: product.name,
        orderedTimes: 1,
      };
    }
  });
  return newCombinedProductList;
}

agenda.define('consolidateProductsOrdered', async (job, done) => {
  // Connect to the db

  try {
    const db = await MongoClient.connect(mongoConnectionString);
    const howManyDaysBackToPickFrom = 7;

    const dateToPickFrom = new Date(job.attrs.lastRunAt);
    dateToPickFrom.setDate(dateToPickFrom.getDate() - howManyDaysBackToPickFrom);

    console.log(`Run At ${job.attrs.lastRunAt}`);

    const newUpdatedOrders = await db.collection('Orders').find({
      $and: [
        { updatedAt: { $gt: dateToPickFrom } },
        { order_status: 'Completed' }],
    }, { customer_details: 1 }).toArray();

    newUpdatedOrders.forEach(async (order) => {
      const last10Orders = await db.collection('Orders').find({
        $and: [
          { order_status: 'Completed' },
          { 'customer_details._id': order.customer_details._id },
        ],
      }).sort({ createdAt: -1 }).limit(10)
        .toArray();

      let combinedProductList = {};
      const prevOrdersConsidered = [];

      last10Orders.forEach((ord) => {
        combinedProductList = combineOrders(ord.products, combinedProductList);
        prevOrdersConsidered.push(ord._id);
      });

      const recommendation = {
        customerId: order.customer_details._id,
        recPrevOrderedProducts: {
          prevOrdersConsidered,
          prevOrderedProducts: combinedProductList,
        },
        updatedAt: new Date(),
      };

      await db.collection('Recommendations').replaceOne(
        { customerId: order.customer_details._id },
        { $set: recommendation },
        { upsert: true },
      );
    });
    // db.close();
  } catch (err) {
    // db.close();
    console.log(err);
  }

  done();
});

agenda.on('ready', () => {
  // Run at 8 am every day
  agenda.every('0 8 * * *', 'consolidateProductsOrdered');
  // agenda.every('1 minute', 'consolidateProductsOrdered');

  // Alternatively, you could also do:
  // agenda.every('*/3 * * * *', 'consolidateProductsOrdered');

  agenda.start();
});
